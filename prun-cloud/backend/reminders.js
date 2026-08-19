// reminders.js
// Avisos automáticos: detalle de pago (antes/después del vencimiento) y
// renovación de contrato próxima a vencer. Cada uno se puede prender o
// apagar por separado desde "Apariencia del sitio" en el panel.
const supabase = require('./supabaseClient');
const { sendMail } = require('./mailer');
const { buildTenantDetailItems, buildDetailHtml, getSiteConfig, getPaymentDetailNotes, getPaymentDetailHeaderLines, computeTenantStatus, getMissingPayments, getCurrentRentAmount } = require('./paymentDetail');

const DIAS_ENTRE_AVISOS_PAGO = 3; // no perseguir a nadie todos los dias
const DIAS_ANTES_RENOVACION = 30; // avisar cuando falten 30 dias o menos
const DIAS_ENTRE_AVISOS_RENOVACION = 7; // reintentar el aviso una vez por semana si sigue sin renovarse

async function yaSeAviso(tipo, tenantId, dias) {
  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase.from('reminder_log').select('id').eq('tipo', tipo).eq('tenant_id', tenantId).gte('sent_at', desde).limit(1);
  return !!(data && data.length);
}
// Para avisos que tienen que salir como mucho UNA vez por mes calendario
// (no "cada X días"), como el resumen del día 1.
async function yaSeAvisoEstePeriodo(tipo, tenantId, period) {
  const { data } = await supabase.from('reminder_log').select('id').eq('tipo', tipo).eq('tenant_id', tenantId).eq('period', period).limit(1);
  return !!(data && data.length);
}
async function registrarAviso(tipo, tenantId, period) {
  await supabase.from('reminder_log').insert([{ tipo, tenant_id: tenantId, period: period || null }]);
}

// Manda el detalle de pago a quienes tengan algo pendiente, sin repetir
// el aviso antes de DIAS_ENTRE_AVISOS_PAGO días.
async function runPaymentReminders() {
  const config = await getSiteConfig();
  if (!config || !config.payment_reminders_enabled) return { skipped: true };

  const { data: tenants } = await supabase.from('tenants').select('*');
  let enviados = 0;
  const detalle = [];
  for (const tenant of tenants || []) {
    try {
      if (computeTenantStatus(tenant) === 'rescindido') { detalle.push(`${tenant.name}: contrato ya finalizado`); continue; }
      if (!tenant.email) { detalle.push(`${tenant.name}: no tiene email cargado`); continue; }
      const missing = getMissingPayments(tenant);
      if (!missing.length) { detalle.push(`${tenant.name}: no debe ningún mes de alquiler`); continue; }
      if (await yaSeAviso('payment', tenant.id, DIAS_ENTRE_AVISOS_PAGO)) { detalle.push(`${tenant.name}: ya se le avisó hace menos de ${DIAS_ENTRE_AVISOS_PAGO} días`); continue; }

      const items = await buildTenantDetailItems(tenant);
      if (!items.length) { detalle.push(`${tenant.name}: no se pudo armar el detalle de pago (revisar manualmente)`); continue; }
      const { data: property } = await supabase.from('properties').select('title').eq('id', tenant.property_id).maybeSingle();
      const footerNotes = await getPaymentDetailNotes();
      const headerLines = await getPaymentDetailHeaderLines();
      const html = buildDetailHtml({
        tenantName: tenant.name, propertyLabel: property ? property.title : '-',
        items, config, currency: tenant.currency || 'ARS', footerNotes, headerLines,
      });

      await sendMail({ to: tenant.email, subject: 'Recordatorio de pago pendiente', html });
      await registrarAviso('payment', tenant.id);
      enviados++;
      detalle.push(`${tenant.name}: enviado ✔`);
    } catch (err) {
      detalle.push(`${tenant.name}: error — ${err.message}`);
      console.error(`Error mandando recordatorio de pago a inquilino ${tenant.id} ->`, err.message);
    }
  }
  return { enviados, detalle };
}

// Avisa cuando un contrato está por vencer (dentro de DIAS_ANTES_RENOVACION
// días), tanto al inquilino como a la inmobiliaria, sin repetir el aviso
// antes de DIAS_ENTRE_AVISOS_RENOVACION días.
async function runRenewalReminders() {
  const config = await getSiteConfig();
  if (!config || !config.renewal_reminders_enabled) return { skipped: true };

  const { data: tenants } = await supabase.from('tenants').select('*');
  const hoy = new Date();
  const limite = new Date(Date.now() + DIAS_ANTES_RENOVACION * 24 * 60 * 60 * 1000);
  let enviados = 0;
  for (const tenant of tenants || []) {
    try {
      if (computeTenantStatus(tenant) === 'rescindido') continue;
      if (!tenant.end_date) continue;
      const endDate = new Date(tenant.end_date + 'T00:00:00');
      if (endDate < hoy || endDate > limite) continue; // ya vencido, o todavia falta mucho
      if (await yaSeAviso('renewal', tenant.id, DIAS_ENTRE_AVISOS_RENOVACION)) continue;

      const diasRestantes = Math.ceil((endDate - hoy) / (1000 * 60 * 60 * 24));
      const fechaFormateada = endDate.toLocaleDateString('es-AR');

      // Aviso a la inmobiliaria (al mail de contacto configurado en el sitio)
      if (config.contact_email) {
        await sendMail({
          to: config.contact_email, subject: `Contrato próximo a vencer — ${tenant.name}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:480px">
            <p>El contrato de <strong>${tenant.name}</strong> vence el <strong>${fechaFormateada}</strong> (en ${diasRestantes} día(s)).</p>
            <p>Convendría contactarlo para definir si renueva o entrega la propiedad.</p>
          </div>`,
        });
      }
      // Aviso al inquilino
      if (tenant.email) {
        await sendMail({
          to: tenant.email, subject: 'Tu contrato está por vencer',
          html: `<div style="font-family:Arial,sans-serif;max-width:480px">
            <p>Hola ${tenant.name},</p>
            <p>Te contactamos porque tu contrato vence el <strong>${fechaFormateada}</strong>.</p>
            <p>Si querés renovarlo, escribinos para coordinar los detalles.</p>
          </div>`,
        });
      }
      await registrarAviso('renewal', tenant.id);
      enviados++;
    } catch (err) {
      console.error(`Error mandando aviso de renovación a inquilino ${tenant.id} ->`, err.message);
    }
  }
  return { enviados };
}

// Resumen del mes: el día 1 (o cuando el servidor se despierte y todavía
// no se le mandó nada a alguien en ESTE mes puntual), le avisa a cada
// inquilino con contrato vigente ese mes cuánto es el alquiler que le
// corresponde pagar — es un aviso preventivo, no de deuda (no importa si
// todavía no venció ni si ya pagó).
async function runMonthlySummary() {
  const config = await getSiteConfig();
  if (!config || !config.monthly_summary_enabled) return { skipped: true };

  const now = new Date();
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const inicioMes = new Date(now.getFullYear(), now.getMonth(), 1);
  const finMes = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const { data: tenants } = await supabase.from('tenants').select('*');
  let enviados = 0;
  const detalle = [];
  for (const tenant of tenants || []) {
    try {
      if (computeTenantStatus(tenant) === 'rescindido') { detalle.push(`${tenant.name}: contrato ya finalizado`); continue; }
      if (!tenant.start_date || !tenant.end_date) { detalle.push(`${tenant.name}: sin fechas de contrato cargadas`); continue; }
      const start = new Date(tenant.start_date + 'T00:00:00');
      const end = new Date(tenant.end_date + 'T00:00:00');
      if (start > finMes || end < inicioMes) { detalle.push(`${tenant.name}: su contrato no cubre este mes`); continue; }
      if (!tenant.email) { detalle.push(`${tenant.name}: no tiene email cargado`); continue; }
      if (await yaSeAvisoEstePeriodo('monthly_summary', tenant.id, currentPeriod)) { detalle.push(`${tenant.name}: ya se le mandó el resumen de este mes`); continue; }

      const rent = getCurrentRentAmount(tenant);
      const mesLabel = now.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });

      await sendMail({
        to: tenant.email, subject: `Tu alquiler de ${mesLabel}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:480px">
          <p>Hola ${tenant.name},</p>
          <p>Te escribimos para recordarte el alquiler correspondiente a <strong>${mesLabel}</strong>:</p>
          <p style="font-size:18px;font-weight:bold">${tenant.currency || 'ARS'} ${Math.round(rent).toLocaleString('es-AR')}</p>
          <p>Recordá que tenés hasta el día 10 para pagarlo sin recargo.</p>
        </div>`,
      });
      await registrarAviso('monthly_summary', tenant.id, currentPeriod);
      enviados++;
      detalle.push(`${tenant.name}: enviado ✔`);
    } catch (err) {
      detalle.push(`${tenant.name}: error — ${err.message}`);
      console.error(`Error mandando resumen mensual a inquilino ${tenant.id} ->`, err.message);
    }
  }
  return { enviados, detalle };
}

module.exports = { runPaymentReminders, runRenewalReminders, runMonthlySummary };
