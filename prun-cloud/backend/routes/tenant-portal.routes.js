// routes/tenant-portal.routes.js
const express = require('express');
const multer = require('multer');
const supabase = require('../supabaseClient');
const { requireAuth } = require('../auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// El inquilino logueado ve sus propios reclamos (con presupuestos y estado)
// y puede cargar uno nuevo. Nunca puede editar ni borrar nada.
router.get('/my-repairs', requireAuth, async (req, res) => {
  try {
    const email = req.user.email;
    const { data: tenant, error: tenantErr } = await supabase
      .from('tenants').select('property_id').eq('email', email).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (tenantErr) throw tenantErr;
    if (!tenant || !tenant.property_id) {
      return res.json({ hasContract: false, repairs: [] });
    }
    const { data: repairs, error } = await supabase
      .from('repairs').select('*').eq('property_id', tenant.property_id).order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ hasContract: true, repairs: repairs || [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al buscar tus reclamos.' });
  }
});

router.post('/report', requireAuth, async (req, res) => {
  try {
    const email = req.user.email;
    const { title, notes } = req.body;
    if (!title) return res.status(400).json({ error: 'Contanos qué hay que reparar.' });

    const { data: tenant, error: tenantErr } = await supabase
      .from('tenants').select('property_id').eq('email', email).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (tenantErr) throw tenantErr;
    if (!tenant || !tenant.property_id) {
      return res.status(404).json({ error: 'No encontramos un contrato de alquiler asociado a tu cuenta. Si ya sos inquilino nuestro, escribinos por Contacto para vincular tu cuenta.' });
    }

    const { data, error } = await supabase.from('repairs').insert([{
      property_id: tenant.property_id, type: 'incidencia', status: 'reportado',
      title, notes: notes || '', date_reported: new Date().toISOString().slice(0, 10),
      payer: 'a definir',
    }]).select().single();
    if (error) throw error;
    res.status(201).json({ ok: true, repair: data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al enviar tu reporte. Probá de nuevo en un momento.' });
  }
});

// El inquilino ve los comprobantes de pago que el mismo cargo (servicios u
// otros pagos vinculados a la propiedad que alquila). Nunca ve los de otros
// inquilinos, y nunca puede editar ni borrar los que ya subio.
router.get('/payments', requireAuth, async (req, res) => {
  try {
    const email = req.user.email;
    const { data: tenant } = await supabase
      .from('tenants').select('property_id').eq('email', email).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!tenant || !tenant.property_id) return res.json({ hasContract: false, payments: [] });

    const { data: payments, error } = await supabase
      .from('payment_receipts').select('*').eq('property_id', tenant.property_id).eq('tenant_email', email).order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ hasContract: true, payments: payments || [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al buscar tus comprobantes de pago.' });
  }
});

// Subir un comprobante de pago (servicios u otros) vinculado a la propiedad alquilada.
router.post('/payments', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const email = req.user.email;
    const { concept, amount, period, notes } = req.body;
    if (!concept) return res.status(400).json({ error: 'Contanos de qué es el pago.' });
    if (!req.file) return res.status(400).json({ error: 'Adjuntá el comprobante de pago.' });

    const { data: tenant } = await supabase
      .from('tenants').select('property_id, name').eq('email', email).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!tenant || !tenant.property_id) {
      return res.status(404).json({ error: 'No encontramos un contrato de alquiler asociado a tu cuenta. Si ya sos inquilino nuestro, escribinos por Contacto para vincular tu cuenta.' });
    }

    const fileName = `comprobante-${Date.now()}-${Math.random().toString(36).slice(2,8)}.${req.file.originalname.split('.').pop()}`;
    const { error: uploadErr } = await supabase.storage.from('property-photos').upload(fileName, req.file.buffer, { contentType: req.file.mimetype });
    if (uploadErr) throw uploadErr;
    const { data: pub } = supabase.storage.from('property-photos').getPublicUrl(fileName);

    const { data, error } = await supabase.from('payment_receipts').insert([{
      property_id: tenant.property_id, tenant_email: email, tenant_name: tenant.name || '',
      concept, amount: Number(amount) || 0, period: period || '', file_url: pub.publicUrl, notes: notes || '',
    }]).select().single();
    if (error) throw error;
    res.status(201).json({ ok: true, payment: data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al subir el comprobante. Probá de nuevo en un momento.' });
  }
});

// El inquilino ve online su propio detalle de pago (lo mismo que se le
// manda por mail), sin poder ver el de otros inquilinos.
const { buildTenantDetailItems, buildDetailHtml, getSiteConfig, getPaymentDetailNotes } = require('../paymentDetail');
router.get('/payment-detail', requireAuth, async (req, res) => {
  try {
    const email = req.user.email;
    const supabase = require('../supabaseClient');
    const { data: tenant } = await supabase
      .from('tenants').select('*').eq('email', email).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!tenant) return res.json({ hasContract: false });

    const { data: property } = await supabase.from('properties').select('*').eq('id', tenant.property_id).maybeSingle();
    const items = await buildTenantDetailItems(tenant);
    const total = items.reduce((s, i) => s + i.amount, 0);
    const config = await getSiteConfig();
    const footerNotes = await getPaymentDetailNotes();
    const html = buildDetailHtml({
      tenantName: tenant.name, propertyLabel: property ? property.title : '-',
      items, config, currency: tenant.currency || 'ARS', footerNotes,
    });
    res.json({ hasContract: true, items, total, currency: tenant.currency || 'ARS', html });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al buscar tu detalle de pago.' });
  }
});

module.exports = router;
