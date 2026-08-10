// routes/payment-detail.routes.js
const express = require('express');
const supabase = require('../supabaseClient');
const { requireAuth } = require('../auth');
const { buildTenantDetailItems, buildDetailHtml, buildOwnerDetailItems, buildOwnerDetailHtml, getSiteConfig, getPaymentDetailNotes, getPaymentDetailHeaderLines, computeTenantStatus, buildTenantCollectionsReport } = require('../paymentDetail');
const { sendMail } = require('../mailer');

const router = express.Router();

async function loadTenantAndProperty(id) {
  const { data: tenant } = await supabase.from('tenants').select('*').eq('id', id).maybeSingle();
  if (!tenant) return { tenant: null, property: null };
  const { data: property } = await supabase.from('properties').select('*').eq('id', tenant.property_id).maybeSingle();
  return { tenant, property };
}

// Vista previa para el panel: junta los datos sin mandar nada todavia.
router.get('/tenants/:id', requireAuth, async (req, res) => {
  try {
    const { tenant, property } = await loadTenantAndProperty(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Inquilino no encontrado.' });
    const items = await buildTenantDetailItems(tenant);
    const total = items.reduce((s, i) => s + i.amount, 0);
    res.json({
      tenantName: tenant.name, tenantEmail: tenant.email,
      propertyLabel: property ? property.title : '-',
      items, total, currency: tenant.currency || 'ARS',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al armar el detalle de pago.' });
  }
});

// Manda el detalle de pago por mail al inquilino.
router.post('/tenants/:id/send', requireAuth, async (req, res) => {
  try {
    const { tenant, property } = await loadTenantAndProperty(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Inquilino no encontrado.' });
    if (!tenant.email) return res.status(400).json({ error: 'Este inquilino no tiene un email cargado.' });

    const items = await buildTenantDetailItems(tenant);
    if (!items.length) return res.status(400).json({ error: 'Este inquilino no tiene nada pendiente de pago — no hay nada para enviar.' });

    const config = await getSiteConfig();
    const footerNotes = await getPaymentDetailNotes();
    const headerLines = await getPaymentDetailHeaderLines();
    const html = buildDetailHtml({
      tenantName: tenant.name,
      propertyLabel: property ? property.title : '-',
      items, config, currency: tenant.currency || 'ARS', footerNotes, headerLines,
    });
    await sendMail({ to: tenant.email, subject: 'Detalle de pago — Prun Bienes Raíces', html });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Error al enviar el email.' });
  }
});

// Vista previa para el panel: detalle de pago de un propietario.
router.get('/owners/:id', requireAuth, async (req, res) => {
  try {
    const { data: owner } = await supabase.from('owners').select('*').eq('id', req.params.id).maybeSingle();
    if (!owner) return res.status(404).json({ error: 'Propietario no encontrado.' });
    const items = await buildOwnerDetailItems(owner);
    const total = items.reduce((s, i) => s + i.net, 0);
    res.json({ ownerName: owner.name, ownerEmail: owner.email, items, total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al armar el detalle de pago.' });
  }
});

// Manda el detalle de pago por mail al propietario.
router.post('/owners/:id/send', requireAuth, async (req, res) => {
  try {
    const { data: owner } = await supabase.from('owners').select('*').eq('id', req.params.id).maybeSingle();
    if (!owner) return res.status(404).json({ error: 'Propietario no encontrado.' });
    if (!owner.email) return res.status(400).json({ error: 'Este propietario no tiene un email cargado.' });

    const items = await buildOwnerDetailItems(owner);
    if (!items.length) return res.status(400).json({ error: 'Este propietario no tiene nada para cobrar este mes todavía (el inquilino no pagó el mes actual) — no hay nada para enviar.' });

    const config = await getSiteConfig();
    const footerNotes = await getPaymentDetailNotes();
    const headerLines = await getPaymentDetailHeaderLines();
    const html = buildOwnerDetailHtml({ ownerName: owner.name, items, config, footerNotes, headerLines });
    await sendMail({ to: owner.email, subject: 'Detalle de pago — Prun Bienes Raíces', html });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Error al enviar el email.' });
  }
});

// Resumen para "Cobros del mes actual": junta, para cada inquilino activo,
// todo lo que debe (alquiler + expensas del edificio, ya con la lógica en
// cascada) en un solo pedido. Reutiliza exactamente el mismo cálculo que el
// detalle de pago real, para que nunca queden desincronizados.
router.get('/rent-collection-summary', requireAuth, async (req, res) => {
  try {
    const { data: tenants } = await supabase.from('tenants').select('*');
    const { data: properties } = await supabase.from('properties').select('id, title, branch_id');
    const propMap = {};
    (properties || []).forEach(p => { propMap[p.id] = p; });

    const rows = [];
    for (const tenant of tenants || []) {
      if (computeTenantStatus(tenant) === 'rescindido') continue;
      const items = await buildTenantDetailItems(tenant);
      const owed = items.reduce((s, i) => s + i.amount, 0);
      const prop = propMap[tenant.property_id];
      rows.push({
        tenantId: tenant.id, tenantName: tenant.name, currency: tenant.currency || 'ARS',
        propertyId: tenant.property_id, propertyName: prop ? prop.title : '-', branchId: prop ? prop.branch_id : null,
        items, owed,
      });
    }
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al armar el resumen de cobros.' });
  }
});

// Reporte completo de cobros: junta, para TODOS los inquilinos activos, el
// alquiler y las expensas separados en 4 listas (pendientes/pagados de cada
// uno), para que el panel pueda mostrarlas como vistas distintas.
router.get('/collections-report', requireAuth, async (req, res) => {
  try {
    const { data: tenants } = await supabase.from('tenants').select('*');
    const { data: properties } = await supabase.from('properties').select('id, title, branch_id, development_id');
    const { data: developments } = await supabase.from('developments').select('id, name');
    const propMap = {}; (properties || []).forEach(p => { propMap[p.id] = p; });
    const devMap = {}; (developments || []).forEach(d => { devMap[d.id] = d; });

    const rentPending = [], rentPaid = [], expensasPending = [], expensasPaid = [], otherPending = [], otherPaid = [];

    for (const tenant of tenants || []) {
      if (computeTenantStatus(tenant) === 'rescindido') continue;
      const property = propMap[tenant.property_id];
      const report = await buildTenantCollectionsReport(tenant, property);
      const base = {
        tenantId: tenant.id, tenantName: tenant.name,
        propertyName: property ? property.title : '-', branchId: property ? property.branch_id : null,
        developmentName: property && property.development_id ? (devMap[property.development_id] || {}).name : null,
      };
      report.rentPending.forEach(x => rentPending.push({ ...base, ...x }));
      report.rentPaid.forEach(x => rentPaid.push({ ...base, ...x }));
      report.expensasPending.forEach(x => expensasPending.push({ ...base, ...x }));
      report.expensasPaid.forEach(x => expensasPaid.push({ ...base, ...x }));
      report.otherPending.forEach(x => otherPending.push({ ...base, ...x }));
      report.otherPaid.forEach(x => otherPaid.push({ ...base, ...x }));
    }
    res.json({ rentPending, rentPaid, expensasPending, expensasPaid, otherPending, otherPaid });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al armar el reporte de cobros.' });
  }
});

module.exports = router;
