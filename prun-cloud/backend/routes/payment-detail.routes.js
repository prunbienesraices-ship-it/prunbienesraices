// routes/payment-detail.routes.js
const express = require('express');
const supabase = require('../supabaseClient');
const { requireAuth } = require('../auth');
const { buildTenantDetailItems, buildDetailHtml, buildOwnerDetailItems, buildOwnerDetailHtml, getSiteConfig, getPaymentDetailNotes, getPaymentDetailHeaderLines } = require('../paymentDetail');
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
    if (!items.length) return res.status(400).json({ error: 'Este propietario no tiene propiedades con inquilino activo — no hay nada para enviar.' });

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

module.exports = router;
