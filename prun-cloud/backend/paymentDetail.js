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

  // Expensas del edificio al que pertenece la propiedad del inquilino (si
  // está vinculada a un edificio). Funciona EXACTAMENTE igual que el
  // alquiler: cada mes de expensas que queda totalmente atrás "se cierra" a
  // su monto final (con su propio interés adentro), y ese total se suma
  // como capital del mes de expensas siguiente, sobre el que se calculan
  // sus 3 nuevos vencimientos.
  const { data: property } = await supabase.from('properties').select('development_id').eq('id', tenant.property_id).maybeSingle();
  if (property && property.development_id) {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const now = new Date();
    const { data: expensasList } = await supabase.from('expensas').select('*').eq('development_id', property.development_id);

    // Solo las que ya vencieron, no son muy viejas, y tienen monto cargado,
    // ordenadas de la mas vieja a la mas nueva (igual que el alquiler).
    const pendingExpensas = (expensasList || [])
      .filter(ex => {
        const periodDate = periodToDate(ex.period);
        if (periodDate > now) return false;
        if (periodDate < sixMonthsAgo) return false;
        if (!Number(ex.total_amount)) return false;
        return !items.some(i => /expensa/i.test(i.concept) && i.concept.includes(ex.period));
      })
      .sort((a, b) => periodToDate(a.period) - periodToDate(b.period));

    if (pendingExpensas.length) {
      const closedExpensas = pendingExpensas.slice(0, -1);
      const currentExpensa = pendingExpensas[pendingExpensas.length - 1];

      // Las expensas de meses ya totalmente pasados se cierran a su ultimo
      // vencimiento, cada una con su propia tasa.
      let closedTotal = 0;
      closedExpensas.forEach(ex => {
        const [y, m] = ex.period.split('-').map(Number);
        const daysInMonth = new Date(y, m, 0).getDate();
        const coef = ex.late_coefficient || 0;
        closedTotal += Number(ex.total_amount) * (1 + (coef / 100) * daysInMonth);
      });

      // Las del mes mas reciente calculan sus 3 vencimientos sobre el
      // capital total: lo que ya se debia de expensas, mas la de este mes.
      const [cy, cm] = currentExpensa.period.split('-').map(Number);
      const daysInCurrentMonth = new Date(cy, cm, 0).getDate();
      const coef = currentExpensa.late_coefficient || 0;
      const principal = closedTotal + Number(currentExpensa.total_amount);
      const tier1 = principal;
      const tier2 = principal * (1 + (coef / 100) * 20);
      const tier3 = principal * (1 + (coef / 100) * daysInCurrentMonth);

      const isCurrentCalendarMonth = now.getFullYear() === cy && now.getMonth() === cm - 1;
      const dayReference = isCurrentCalendarMonth ? now.getDate() : (daysInCurrentMonth + 1);
      const amountToday = dayReference <= 10 ? tier1 : dayReference <= 20 ? tier2 : tier3;

      const label = closedExpensas.length
        ? `EXPENSAS ADEUDADAS (${monthLabel(pendingExpensas[0].period)} a ${monthLabel(currentExpensa.period)})`
        : `EXPENSAS ${monthLabel(currentExpensa.period)}`;

      items.push({
        concept: label, amount: Math.round(amountToday), hasTiers: true,
        tier1: Math.round(tier1), tier2: Math.round(tier2), tier3: Math.round(tier3),
      });
    }
  }

  return items;
}

async function getSiteConfig() {
  const { data } = await supabase.from('site_config').select('*').eq('id', 1).maybeSingle();
  return data || {};
}

// Trae las notas editables que van al final del detalle de pago (el aviso
// sobre pagos parciales, donde mandar comprobantes, etc.), y las líneas
// editables que van arriba a la izquierda (dirección, teléfono, mail),
// configuradas por el Administrador en "Modelo de detalle de pago".
async function getPaymentDetailNotes() {
  const { data } = await supabase.from('payment_detail_template').select('footer_notes').eq('id', 1).maybeSingle();
  return (data && data.footer_notes && data.footer_notes.length) ? data.footer_notes : [
    'LOS PAGOS NO PUEDEN SER PARCIALES, SOLO SE ACEPTAN PAGOS TOTAL DE LA DEUDA.',
  ];
}
async function getPaymentDetailHeaderLines() {
  const { data } = await supabase.from('payment_detail_template').select('header_lines').eq('id', 1).maybeSingle();
  return (data && data.header_lines && data.header_lines.length) ? data.header_lines : [
    '{{ADDRESS}}', 'Tel. {{PHONE}}', 'mail: {{EMAIL}}',
  ];
}
// Reemplaza los codigos {{ADDRESS}}, {{PHONE}}, {{EMAIL}} de una linea por
// los datos reales cargados en "Apariencia del sitio".
function fillHeaderTokens(line, config) {
  const email = (config && config.contact_email) || '';
  const emailLink = `<a href="mailto:${email}" style="color:#1155cc">${email}</a>`;
  return line
    .split('{{ADDRESS}}').join((config && config.office_address) || '')
    .split('{{PHONE}}').join((config && config.contact_phone) || '')
    .split('{{EMAIL}}').join(emailLink);
}
// Arma el bloque HTML con las lineas del encabezado (arriba a la izquierda).
function buildHeaderLinesHtml(lines, config) {
  return (lines || [])
    .map(l => fillHeaderTokens(l, config))
    .filter(Boolean)
    .join('<br>');
}
// Arma el bloque HTML con esas notas, una debajo de la otra. Soporta el
// código {{EMAIL}} para insertar automáticamente el mail de contacto como
// link, sin tener que escribirlo a mano cada vez.
function buildFooterNotesHtml(notes, config) {
  const email = (config && config.contact_email) || '';
  const emailLink = `<a href="mailto:${email}" style="color:#1155cc">${email}</a>`;
  return (notes || []).map(n => `<p style="margin:0 0 8px 0">${n.split('{{EMAIL}}').join(emailLink)}</p>`).join('');
}

// Arma el HTML del detalle de pago, con el mismo estilo del modelo en Word
// (encabezado con datos de la inmobiliaria, nombre, propiedad, detalle en
// lista, y el texto fijo de abajo sobre como pagar). Cada mes de alquiler
// muestra los 3 vencimientos posibles, para que el inquilino sepa cuanto
// le sale segun cuando pague.
function buildDetailHtml({ tenantName, propertyLabel, items, config, currency, footerNotes, headerLines }) {
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
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="margin:0;padding:0">
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
    <table style="width:100%;border:2px solid #000;border-collapse:collapse">
      <tr>
        <td style="padding:16px;vertical-align:top">
          <div style="font-size:16px;font-weight:600;margin-bottom:8px">${config.logo_text || 'Administración Prun Bienes Raíces'}</div>
          <div style="border-top:1px solid #4a90d9;width:70%;margin-bottom:10px"></div>
          <div style="font-size:13px;line-height:1.8">
            ${buildHeaderLinesHtml(headerLines, config)}
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
        ${buildFooterNotesHtml(footerNotes, config)}
      </td></tr>
    </table>
  </div></body></html>`;
}

// Arma el detalle de pago de un PROPIETARIO: por cada propiedad suya con
// inquilino, cuanto se cobra de alquiler, cuanto se descuenta de comisión
// por el servicio (según el tipo cargado en su ficha: porcentaje o monto
// fijo), y cuánto neto le corresponde a él.
async function buildOwnerDetailItems(owner) {
  const items = [];
  const { data: properties } = await supabase.from('properties').select('*').eq('owner_id', owner.id);
  const currentPeriod = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  for (const prop of properties || []) {
    const { data: tenant } = await supabase.from('tenants').select('*').eq('property_id', prop.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!tenant) continue;
    const status = computeTenantStatus(tenant);
    if (status === 'rescindido') continue;

    // Solo se muestra si el inquilino YA pagó el mes actual — si todavía no
    // pagó, no aparece nada para esa propiedad (nada que transferirle al
    // propietario todavía).
    const paymentThisMonth = (tenant.payments || []).find(p => p.period === currentPeriod);
    if (!paymentThisMonth) continue;

    const rent = Number(paymentThisMonth.amount) || getCurrentRentAmount(tenant);
    if (!rent) continue;
    const commission = owner.commission_type === 'fixed'
      ? (Number(owner.commission_withholding) || 0)
      : rent * ((Number(owner.commission_withholding) || 0) / 100);
    const net = Math.max(0, rent - commission);
    items.push({
      propertyLabel: prop.title, rent: Math.round(rent), commission: Math.round(commission),
      net: Math.round(net), currency: tenant.currency || 'ARS',
      commissionLabel: owner.commission_type === 'fixed' ? 'Comisión (monto fijo)' : `Comisión (${owner.commission_withholding || 0}%)`,
    });
  }
  return items;
}

// Arma el HTML del detalle de pago del propietario, con el mismo estilo de
// letterhead que el de los inquilinos.
function buildOwnerDetailHtml({ ownerName, items, config, footerNotes, headerLines }) {
  const totalNet = items.reduce((s, i) => s + i.net, 0);
  const money = (n, currency) => `${currency || 'ARS'} ${Number(n).toLocaleString('es-AR')}`;
  const logoImg = config.logo_image ? `<img src="${config.logo_image}" alt="logo" style="width:90px;height:90px;object-fit:contain">` : '';
  const rowsHtml = items.map(i => `
    <tr>
      <td style="padding:8px;border:1px solid #ddd;font-size:12px">${i.propertyLabel}</td>
      <td style="padding:8px;border:1px solid #ddd;font-size:12px;text-align:right">${money(i.rent, i.currency)}</td>
      <td style="padding:8px;border:1px solid #ddd;font-size:12px;text-align:right;color:#b00">-${money(i.commission, i.currency)}<br><span style="font-size:10px;color:#888">${i.commissionLabel}</span></td>
      <td style="padding:8px;border:1px solid #ddd;font-size:12px;text-align:right;font-weight:700">${money(i.net, i.currency)}</td>
    </tr>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="margin:0;padding:0">
  <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto">
    <table style="width:100%;border:2px solid #000;border-collapse:collapse">
      <tr>
        <td style="padding:16px;vertical-align:top">
          <div style="font-size:16px;font-weight:600;margin-bottom:8px">${config.logo_text || 'Administración Prun Bienes Raíces'}</div>
          <div style="border-top:1px solid #4a90d9;width:70%;margin-bottom:10px"></div>
          <div style="font-size:13px;line-height:1.8">
            ${buildHeaderLinesHtml(headerLines, config)}
          </div>
        </td>
        <td style="width:90px;padding:16px;text-align:right;vertical-align:top">${logoImg}</td>
      </tr>
    </table>
    <table style="width:100%;border:2px solid #000;border-top:none;border-collapse:collapse">
      <tr><td style="padding:16px">
        <div style="font-size:13px;margin-bottom:10px">Nombre: <strong>${ownerName}</strong></div>
        <div style="font-size:13px;margin-bottom:6px">Detalle por propiedad:</div>
        <table style="width:100%;border-collapse:collapse;margin-bottom:10px">
          <tr style="background:#f3f3f3">
            <td style="padding:6px 8px;border:1px solid #ddd;font-size:11px;font-weight:700">PROPIEDAD</td>
            <td style="padding:6px 8px;border:1px solid #ddd;font-size:11px;font-weight:700;text-align:right">ALQUILER COBRADO</td>
            <td style="padding:6px 8px;border:1px solid #ddd;font-size:11px;font-weight:700;text-align:right">COMISIÓN</td>
            <td style="padding:6px 8px;border:1px solid #ddd;font-size:11px;font-weight:700;text-align:right">NETO A DEPOSITAR</td>
          </tr>
          ${rowsHtml}
        </table>
        <div style="font-size:14px;font-weight:700;border-top:1px solid #ccc;padding-top:8px">TOTAL NETO A DEPOSITAR: ${money(totalNet, items[0] ? items[0].currency : 'ARS')}</div>
      </td></tr>
    </table>
    ${footerNotes && footerNotes.length ? `<table style="width:100%;border:2px solid #000;border-top:none;border-collapse:collapse">
      <tr><td style="padding:16px;font-size:12px;font-weight:700">
        ${buildFooterNotesHtml(footerNotes, config)}
      </td></tr>
    </table>` : ''}
  </div></body></html>`;
}

// Arma el reporte completo de un inquilino, con el alquiler y las expensas
// SEPARADOS, uno por período individual (no en cascada como el detalle de
// pago), para poder listarlos por separado según pendiente/pagado.
async function buildTenantCollectionsReport(tenant, property) {
  const rentPending = [];
  const rentPaid = [];
  const expensasPending = [];
  const expensasPaid = [];
  const otherPending = [];
  const otherPaid = [];

  // --- Alquiler ---
  const missing = getMissingPayments(tenant);
  missing.forEach(period => {
    const base = getRentAmountForPeriod(tenant, period);
    const [y, m] = period.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const coef = tenant.late_coefficient || 0;
    const now = new Date();
    const isCurrentMonth = now.getFullYear() === y && now.getMonth() === m - 1;
    const dayReference = isCurrentMonth ? now.getDate() : (daysInMonth + 1);
    const tier1 = base, tier2 = base * (1 + (coef / 100) * 20), tier3 = base * (1 + (coef / 100) * daysInMonth);
    const amountToday = dayReference <= 10 ? tier1 : dayReference <= 20 ? tier2 : tier3;
    rentPending.push({ period, periodLabel: monthLabel(period), amount: Math.round(amountToday), currency: tenant.currency || 'ARS' });
  });
  (tenant.payments || []).forEach(p => {
    rentPaid.push({ period: p.period, periodLabel: monthLabel(p.period), amount: Math.round(p.amount), currency: tenant.currency || 'ARS', date: p.date || null });
  });

  // --- Cargos de "otros conceptos" cargados en Cobranzas (honorarios, ABL,
  // luz, gas, multas, expensas cargadas a mano, etc). Cada uno se clasifica
  // como "expensas" (si su concepto lo dice) o "otro" segun corresponda, y
  // como pendiente o pagado segun cuanto se le haya cargado en payments.
  const { data: charges } = await supabase.from('collections_charges').select('*').eq('tenant_id', tenant.id);
  const today = new Date().toISOString().slice(0, 10);
  const expensasPeriodsAlreadyCounted = new Set();

  // --- Expensas del edificio (si la propiedad pertenece a uno) ---
  if (property && property.development_id) {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const now = new Date();
    const { data: expensasList } = await supabase.from('expensas').select('*').eq('development_id', property.development_id);

    (expensasList || []).forEach(ex => {
      const periodDate = periodToDate(ex.period);
      if (periodDate > now || periodDate < sixMonthsAgo || !Number(ex.total_amount)) return;

      // Si ya existe un cargo de expensas para este inquilino en ese período,
      // y está totalmente pagado, se cuenta como abonada.
      const matchingCharge = (charges || []).find(c => /expensa/i.test(c.concept) && c.label === ex.period);
      const paidOnCharge = matchingCharge ? (matchingCharge.payments || []).reduce((s, p) => s + p.amount, 0) : 0;
      const chargeAmount = matchingCharge ? Number(matchingCharge.amount) : Number(ex.total_amount);
      if (matchingCharge) expensasPeriodsAlreadyCounted.add(matchingCharge.id);
      if (matchingCharge && paidOnCharge >= chargeAmount - 0.01) {
        expensasPaid.push({ period: ex.period, periodLabel: monthLabel(ex.period), amount: Math.round(chargeAmount), currency: tenant.currency || 'ARS' });
        return;
      }

      const [y, m] = ex.period.split('-').map(Number);
      const daysInMonth = new Date(y, m, 0).getDate();
      const coef = ex.late_coefficient || 0;
      const isCurrentMonth = now.getFullYear() === y && now.getMonth() === m - 1;
      const dayReference = isCurrentMonth ? now.getDate() : (daysInMonth + 1);
      const base = Number(ex.total_amount);
      const tier1 = base, tier2 = base * (1 + (coef / 100) * 20), tier3 = base * (1 + (coef / 100) * daysInMonth);
      const amountToday = dayReference <= 10 ? tier1 : dayReference <= 20 ? tier2 : tier3;
      expensasPending.push({ period: ex.period, periodLabel: monthLabel(ex.period), amount: Math.round(amountToday), currency: tenant.currency || 'ARS' });
    });
  }

  // --- Todo lo demás cargado en Cobranzas (honorarios, ABL, luz, gas,
  // seguro, multas, y expensas cargadas a mano que no coinciden con una
  // liquidación de edificio) ---
  (charges || []).forEach(c => {
    if (expensasPeriodsAlreadyCounted.has(c.id)) return; // ya contada arriba como expensas del edificio
    const paid = (c.payments || []).reduce((s, p) => s + p.amount, 0);
    const pending = Number(c.amount) - paid;
    const label = `${c.concept}${c.label ? ' — ' + c.label : ''}`;
    if (pending > 0.01) {
      if (c.due_date && c.due_date > today) return; // todavia no vence
      otherPending.push({ period: c.label || '', periodLabel: label, amount: Math.round(pending), currency: tenant.currency || 'ARS' });
    } else if (paid > 0.01) {
      otherPaid.push({ period: c.label || '', periodLabel: label, amount: Math.round(paid), currency: tenant.currency || 'ARS' });
    }
  });

  return { rentPending, rentPaid, expensasPending, expensasPaid, otherPending, otherPaid };
}

module.exports = { buildTenantDetailItems, buildDetailHtml, buildOwnerDetailItems, buildOwnerDetailHtml, getSiteConfig, getPaymentDetailNotes, getPaymentDetailHeaderLines, computeTenantStatus, buildTenantCollectionsReport, getMissingPayments };
