// reminders.js
// Avisos automáticos: detalle de pago (antes/después del vencimiento) y
// renovación de contrato próxima a vencer. Cada uno se puede prender o
// apagar por separado desde "Apariencia del sitio" en el panel.
const supabase = require('./supabaseClient');
const { sendMail } = require('./mailer');
const { buildTenantDetailItems, buildDetailHtml, getSiteConfig, getPaymentDetailNotes, getPaymentDetailHeaderLines, computeTenantStatus, getMissingPayments } = require('./paymentDetail');

const DIAS_ENTRE_AVISOS_PAGO = 3; // no perseguir a nadie todos los dias
const DIAS_ANTES_RENOVACION = 30; // avisar cuando falten 30 dias o menos
const DIAS_ENTRE_AVISOS_RENOVACION = 7; // reintentar el aviso una vez por semana si sigue sin renovarse

async function yaSeAviso(tipo, tenantId, dias) {
  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase.from('reminder_log').select('id').eq('tipo', tipo).eq('tenant_id', tenantId).gte('sent_at', desde).limit(1);
  return !!(data && data.length);
}
async function registrarAviso(tipo, tenantId) {
  await supabase.from('reminder_log').insert([{ tipo, tenant_id: tenantId }]);
}

// Manda el detalle de pago a quienes tengan algo pendiente, sin repetir
// el aviso antes de DIAS_ENTRE_AVISOS_PAGO días.
async function runPaymentReminders() {
  const config = await getSiteConfig();
  if (!config || !config.payment_reminders_enabled) return { skipped: true };

  const { data: tenants } = await supabase.from('tenants').select('*');
  let enviados = 0;
  for (const tenant of tenants || []) {
    try {
      if (computeTenantStatus(tenant) === 'rescindido') continue;
      if (!tenant.email) continue;
      const missing = getMissingPayments(tenant);
      if (!missing.length) continue;
      if (await yaSeAviso('payment', tenant.id, DIAS_ENTRE_AVISOS_PAGO)) continue;

      const items = await buildTenantDetailItems(tenant);
      if (!items.length) continue;
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
    } catch (err) {
      console.error(`Error mandando recordatorio de pago a inquilino ${tenant.id} ->`, err.message);
    }
  }
  return { enviados };
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

module.exports = { runPaymentReminders, runRenewalReminders };
