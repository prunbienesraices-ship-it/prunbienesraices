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
// Mismo sistema de 3 vencimientos que "Cobros del mes actual": hasta el dia
// 10 sin interes, hasta el dia 20 con 20 dias, de ahi en mas con los dias
// que tenga ese mes.
function getLivePaymentInfo(t, period) {
  const base = getRentAmountForPeriod(t, period);
  const [y, m] = period.split('-').map(Number);
  const today = new Date();
  const periodDate = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  const coef = t.late_coefficient || 0;
  if (periodDate > today) return { base, amountToday: base };
  const isCurrentMonth = today.getFullYear() === y && today.getMonth() === m - 1;
  const dayReference = isCurrentMonth ? today.getDate() : (daysInMonth + 1);
  let tierDays;
  if (dayReference <= 10) tierDays = 0;
  else if (dayReference <= 20) tierDays = 20;
  else tierDays = daysInMonth;
  const amountToday = base * (1 + (coef / 100) * tierDays);
  return { base, amountToday };
}
function monthLabel(period) {
  const [y, m] = period.split('-').map(Number);
  return `${MONTHS_ES[m - 1].toUpperCase()} ${y}`;
}

// Arma la lista de items pendientes de un inquilino: meses de alquiler +
// cargos de otros conceptos sin pagar del todo.
async function buildTenantDetailItems(tenant) {
  const items = [];
  const missing = getMissingPayments(tenant);
  missing.forEach(period => {
    const info = getLivePaymentInfo(tenant, period);
    items.push({ concept: `ALQUILER ${monthLabel(period)}`, amount: Math.round(info.amountToday) });
  });

  const { data: charges } = await supabase.from('collections_charges').select('*').eq('tenant_id', tenant.id);
  (charges || []).forEach(c => {
    const paid = (c.payments || []).reduce((s, p) => s + p.amount, 0);
    const pending = Number(c.amount) - paid;
    if (pending > 0.01) {
      items.push({ concept: `${c.concept}${c.label ? ' — ' + c.label : ''}`, amount: Math.round(pending) });
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
// lista, y el texto fijo de abajo sobre como pagar).
function buildDetailHtml({ tenantName, propertyLabel, items, config, currency }) {
  const total = items.reduce((s, i) => s + i.amount, 0);
  const money = n => `${currency || 'ARS'} ${Number(n).toLocaleString('es-AR')}`;
  const logoImg = config.logo_image ? `<img src="${config.logo_image}" alt="logo" style="width:90px;height:90px;object-fit:contain">` : '';
  return `
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
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
        <ul style="font-size:13px;margin:0 0 10px 20px;padding:0">
          ${items.map(i => `<li style="margin-bottom:4px">${i.concept}: <strong>${money(i.amount)}</strong></li>`).join('')}
        </ul>
        <div style="font-size:14px;font-weight:700;border-top:1px solid #ccc;padding-top:8px">TOTAL A PAGAR: ${money(total)}</div>
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
