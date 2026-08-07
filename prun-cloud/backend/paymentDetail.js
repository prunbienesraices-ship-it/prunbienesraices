// paymentDetail.js
// Logica compartida para armar el "Detalle de pago" de un inquilino: junta
// los meses de alquiler pendientes (con el mismo calculo de 3 vencimientos
// que usa "Cobros del mes actual") mas los cargos de "otros conceptos" que
// todavia no esten pagados del todo. La usan tanto el panel (para mandarlo
// por mail) como el portal del inquilino (para que lo vea online).
const supabase = require('./supabaseClient');

const MONTHS_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

function periodToDate(period) { const [y, m] = period.split('-').map(Number); return new Date(y, m - 1, 1); }
function dateToPeriod(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }

function getRentHistory(t) {
  return t.rent_history && t.rent_history.length ? t.rent_history : [{ date: t.start_date, amount: 0 }];
}
function getCurrentRentAmount(t) {
  const hist = getRentHistory(t);
  const today = new Date();
  const applicable = hist.filter(h => new Date(h.date) <= today);
  return applicable.length ? applicable[applicable.length - 1].amount : hist[0].amount;
}
function getRentAmountForPeriod(t, period) {
  const hist = getRentHistory(t);
  const periodDate = periodToDate(period);
  const applicable = hist.filter(h => new Date(h.date) <= periodDate);
  return applicable.length ? applicable[applicable.length - 1].amount : hist[0].amount;
}
function computeTenantStatus(t) {
  if (t.status_override === 'rescindido') return 'rescindido';
  const today = new Date();
  const end = new Date(t.end_date);
  if (end < today) return 'vencido';
  return 'vigente';
}
function getMissingPayments(t) {
  const status = computeTenantStatus(t);
  if (status === 'rescindido') return [];
  const paidPeriods = new Set((t.payments || []).map(p => p.period));
  const start = periodToDate(t.start_date.slice(0, 7) + '-01');
  const today = new Date();
  const end = new Date(t.end_date);
  const lastRelevant = end < today ? end : today;
  const missing = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= lastRelevant) {
    const period = dateToPeriod(cursor);
    if (!paidPeriods.has(period)) missing.push(period);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return missing;
}
function monthLabel(period) {
  const [y, m] = period.split('-').map(Number);
  return `${MONTHS_ES[m - 1].toUpperCase()} ${y}`;
}

// Arma la lista de items pendientes de un inquilino: el alquiler adeudado
// (acumulado, no mes por mes) + los cargos de otros conceptos (ej: expensas)
// que ya estan vencidos y sin pagar del todo.
//
// El alquiler es ACUMULATIVO: cada mes que queda totalmente atras "se cierra"
// a su monto final (con su propio interes ya adentro), y ese total pasa a
// sumarse como capital del mes siguiente, sobre el que se calculan sus 3
// nuevos vencimientos. Ejemplo: si julio (base $180) quedo en $200 y estamos
// en agosto (base $180), el capital de agosto es $200 + $180 = $380: hasta
// el dia 10 se deben esos $380 sin interes nuevo, hasta el dia 20 se le suma
// el interes de 20 dias sobre esos $380, etc.
async function buildTenantDetailItems(tenant) {
  const items = [];
  const missing = getMissingPayments(tenant); // ya viene ordenado del mas viejo al mas nuevo
  if (missing.length) {
    const closedPeriods = missing.slice(0, -1);
    const currentPeriod = missing[missing.length - 1];
    const coef = tenant.late_coefficient || 0;

    // Los meses que ya quedaron totalmente atras se cierran a su ultimo
    // vencimiento (el mes ya paso entero, no hay forma de pagarlo antes).
    let closedTotal = 0;
    closedPeriods.forEach(period => {
      const base = getRentAmountForPeriod(tenant, period);
      const [y, m] = period.split('-').map(Number);
      const daysInMonth = new Date(y, m, 0).getDate();
      closedTotal += base * (1 + (coef / 100) * daysInMonth);
    });

    // El mes mas reciente (el actual) calcula sus 3 vencimientos sobre el
    // capital total: lo que ya se debia de antes, mas el alquiler de este mes.
    const currentBase = getRentAmountForPeriod(tenant, currentPeriod);
    const [cy, cm] = currentPeriod.split('-').map(Number);
    const daysInCurrentMonth = new Date(cy, cm, 0).getDate();
    const principal = closedTotal + currentBase;
    const tier1 = principal;
    const tier2 = principal * (1 + (coef / 100) * 20);
    const tier3 = principal * (1 + (coef / 100) * daysInCurrentMonth);

    const today = new Date();
    const periodDate = new Date(cy, cm - 1, 1);
    const isCurrentCalendarMonth = today.getFullYear() === cy && today.getMonth() === cm - 1;
    const dayReference = periodDate > today ? 1 : (isCurrentCalendarMonth ? today.getDate() : (daysInCurrentMonth + 1));
    const amountToday = dayReference <= 10 ? tier1 : dayReference <= 20 ? tier2 : tier3;

    const label = closedPeriods.length
      ? `ALQUILER ADEUDADO (${monthLabel(missing[0])} a ${monthLabel(currentPeriod)})`
      : `ALQUILER ${monthLabel(currentPeriod)}`;

    items.push({
      concept: label, amount: Math.round(amountToday), hasTiers: true,
      tier1: Math.round(tier1), tier2: Math.round(tier2), tier3: Math.round(tier3),
    });
  }

  // Cargos de otros conceptos (ej: expensas) que ya vencieron y siguen sin
  // pagarse del todo. Si un cargo tiene fecha de vencimiento futura, no se
  // incluye todavia (no esta vencido). Si el cargo tiene una tasa de interes
  // cargada, tambien se le calculan sus propios 3 vencimientos (dia 10, dia
  // 20 y fin del mes de su fecha de vencimiento), igual que el alquiler.
  const today = new Date().toISOString().slice(0, 10);
  const { data: charges } = await supabase.from('collections_charges').select('*').eq('tenant_id', tenant.id);
  (charges || []).forEach(c => {
    if (c.due_date && c.due_date > today) return; // todavia no vence
    const paid = (c.payments || []).reduce((s, p) => s + p.amount, 0);
    const pending = Number(c.amount) - paid;
    if (pending <= 0.01) return;
    const concept = `${c.concept}${c.label ? ' — ' + c.label : ''}`;

    if (c.due_date && c.late_coefficient) {
      const dueDate = new Date(c.due_date + 'T00:00:00');
      const y = dueDate.getFullYear(), m = dueDate.getMonth() + 1;
      const daysInMonth = new Date(y, m, 0).getDate();
      const coef = c.late_coefficient;
      const tier1 = pending;
      const tier2 = pending * (1 + (coef / 100) * 20);
      const tier3 = pending * (1 + (coef / 100) * daysInMonth);
      const now = new Date();
      const isCurrentMonth = now.getFullYear() === y && now.getMonth() === m - 1;
      const dayReference = isCurrentMonth ? now.getDate() : (daysInMonth + 1);
      const amountToday = dayReference <= 10 ? tier1 : dayReference <= 20 ? tier2 : tier3;
      items.push({
        concept, amount: Math.round(amountToday), hasTiers: true,
        tier1: Math.round(tier1), tier2: Math.round(tier2), tier3: Math.round(tier3),
      });
    } else {
      items.push({ concept, amount: Math.round(pending), hasTiers: false });
    }
  });
  return items;
}

async function getSiteConfig() {
  const { data } = await supabase.from('site_config').select('*').eq('id', 1).maybeSingle();
  return data || {};
}

// Arma el HTML del detalle de pago, con el mismo estilo del modelo en Word
// (encabezado con datos de la inmobiliaria, nombre, propiedad, detalle en
// lista, y el texto fijo de abajo sobre como pagar). Cada mes de alquiler
// muestra los 3 vencimientos posibles, para que el inquilino sepa cuanto
// le sale segun cuando pague.
function buildDetailHtml({ tenantName, propertyLabel, items, config, currency }) {
  const total = items.reduce((s, i) => s + i.amount, 0);
  const money = n => `${currency || 'ARS'} ${Number(n).toLocaleString('es-AR')}`;
  const logoImg = config.logo_image ? `<img src="${config.logo_image}" alt="logo" style="width:90px;height:90px;object-fit:contain">` : '';
  const itemsHtml = items.map(i => {
    if (i.hasTiers) {
      return `<li style="margin-bottom:10px">
        <div>${i.concept}</div>
        <table style="width:100%;font-size:12px;margin-top:4px;border-collapse:collapse">
          <tr>
            <td style="padding:4px 8px;background:#f3f3f3;border:1px solid #ddd">Hasta el día 10<br><strong>${money(i.tier1)}</strong></td>
            <td style="padding:4px 8px;background:#f3f3f3;border:1px solid #ddd">Hasta el día 20<br><strong>${money(i.tier2)}</strong></td>
            <td style="padding:4px 8px;background:#f3f3f3;border:1px solid #ddd">Después del 20<br><strong>${money(i.tier3)}</strong></td>
          </tr>
        </table>
      </li>`;
    }
    return `<li style="margin-bottom:4px">${i.concept}: <strong>${money(i.amount)}</strong></li>`;
  }).join('');
  return `
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
    <meta charset="utf-8">
    <table style="width:100%;border:2px solid #000;border-collapse:collapse">
      <tr>
        <td style="padding:16px;vertical-align:top">
          <div style="font-size:16px;font-weight:600;margin-bottom:8px">${config.logo_text || 'Administración Prun Bienes Raíces'}</div>
          <div style="border-top:1px solid #4a90d9;width:70%;margin-bottom:10px"></div>
          <div style="font-size:13px;line-height:1.8">
            ${config.contact_phone ? `Tel. ${config.contact_phone}<br>` : ''}
            mail: <a href="mailto:${config.contact_email || ''}" style="color:#1155cc">${config.contact_email || ''}</a>
          </div>
        </td>
        <td style="width:90px;padding:16px;text-align:right;vertical-align:top">${logoImg}</td>
      </tr>
    </table>
    <table style="width:100%;border:2px solid #000;border-top:none;border-collapse:collapse">
      <tr><td style="padding:16px">
        <div style="font-size:13px;margin-bottom:6px">Nombre: <strong>${tenantName}</strong></div>
        <div style="font-size:13px;margin-bottom:10px">Propiedad: <strong>${propertyLabel}</strong></div>
        <div style="font-size:13px;margin-bottom:6px">Detalle:</div>
        <ul style="font-size:13px;margin:0 0 10px 20px;padding:0;list-style:none">
          ${itemsHtml}
        </ul>
        <div style="font-size:11px;color:#666;margin-bottom:8px">* El monto de alquiler depende de la fecha en que se realice el pago, según el vencimiento correspondiente.</div>
        <div style="font-size:14px;font-weight:700;border-top:1px solid #ccc;padding-top:8px">TOTAL A PAGAR HOY: ${money(total)}</div>
      </td></tr>
    </table>
    <table style="width:100%;border:2px solid #000;border-top:none;border-collapse:collapse">
      <tr><td style="padding:16px;font-size:12px;font-weight:700">
        LOS PAGOS NO PUEDEN SER PARCIALES, SOLO SE ACEPTAN PAGOS TOTAL DE LA DEUDA.
        Los <em><u>comprobantes de servicios y depósito</u></em> deben ser enviados al mail:
        <a href="mailto:${config.contact_email || ''}" style="color:#1155cc">${config.contact_email || ''}</a>,
        asunto: (nombre y apellido, y datos de la propiedad).
      </td></tr>
    </table>
  </div>`;
}

module.exports = { buildTenantDetailItems, buildDetailHtml, getSiteConfig, computeTenantStatus };
