// routes/owner-portal.routes.js
const express = require('express');
const multer = require('multer');
const supabase = require('../supabaseClient');
const { requireAuth } = require('../auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Sube las fotos que adjunte un reclamo al mismo bucket de Supabase Storage
// que ya se usa para las fotos de las propiedades, y devuelve las URLs.
async function uploadReportImages(files) {
  if (!files || !files.length) return [];
  const urls = [];
  for (const file of files) {
    const fileName = `reclamo-${Date.now()}-${Math.round(Math.random() * 1e9)}.${file.originalname.split('.').pop()}`;
    const { error } = await supabase.storage.from('property-photos').upload(fileName, file.buffer, { contentType: file.mimetype });
    if (error) { console.error('Error subiendo imagen de reclamo:', error); continue; }
    const { data } = supabase.storage.from('property-photos').getPublicUrl(fileName);
    urls.push(data.publicUrl);
  }
  return urls;
}

// El propietario logueado (con su cuenta de cliente/sitio) ve sus propiedades
// y los reclamos/reparaciones vinculados a ellas.
router.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const email = req.user.email;

    // Buscamos su ficha de propietario por email (la misma que usa el panel interno).
    const { data: owner, error: ownerErr } = await supabase
      .from('owners').select('*').eq('email', email).maybeSingle();
    if (ownerErr) throw ownerErr;

    if (!owner) {
      return res.json({ isOwner: false, properties: [], repairs: [] });
    }

    const { data: properties, error: propsErr } = await supabase
      .from('properties').select('*').eq('owner_id', owner.id).order('created_at', { ascending: false });
    if (propsErr) throw propsErr;

    const propertyIds = (properties || []).map(p => p.id);
    let repairs = [];
    let tenants = [];
    let payments = [];
    if (propertyIds.length) {
      const { data: repairsData, error: repairsErr } = await supabase
        .from('repairs').select('*').in('property_id', propertyIds).order('created_at', { ascending: false });
      if (repairsErr) throw repairsErr;
      repairs = repairsData || [];

      // Inquilino/s de sus propiedades, para que el propietario pueda ver el
      // estado de pago del alquiler (nunca puede editar nada de esto).
      const { data: tenantsData, error: tenantsErr } = await supabase
        .from('tenants').select('id, name, phone, email, property_id, start_date, end_date, currency, rent_history, payments, payday, late_coefficient, status_override')
        .in('property_id', propertyIds).order('created_at', { ascending: false });
      if (tenantsErr) throw tenantsErr;
      tenants = tenantsData || [];

      // Comprobantes de pago de servicios/otros que el inquilino fue subiendo.
      const { data: paymentsData, error: paymentsErr } = await supabase
        .from('payment_receipts').select('*').in('property_id', propertyIds).order('created_at', { ascending: false });
      if (paymentsErr) throw paymentsErr;
      payments = paymentsData || [];
    }

    // Liquidaciones de sus inquilinos, para que el propietario vea cuánto le
    // corresponde de cada período (nunca puede editar nada de esto).
    let settlements = [];
    const tenantIds = tenants.map(t => t.id);
    if (tenantIds.length) {
      const { data: settlementsData, error: settlementsErr } = await supabase
        .from('settlements').select('*').in('tenant_id', tenantIds).order('created_at', { ascending: false });
      if (settlementsErr) throw settlementsErr;
      settlements = settlementsData || [];
    }

    res.json({ isOwner: true, owner, properties: properties || [], repairs, tenants, payments, settlements });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al buscar tu información como propietario.' });
  }
});

// El propietario puede cargar un reclamo nuevo (nunca editar ni borrar nada),
// solo para una de sus propias propiedades.
router.post('/report', requireAuth, upload.array('images', 5), async (req, res) => {
  try {
    const email = req.user.email;
    const { property_id, title, notes } = req.body;
    if (!title) return res.status(400).json({ error: 'Contanos qué hay que reparar.' });

    const { data: owner, error: ownerErr } = await supabase.from('owners').select('id').eq('email', email).maybeSingle();
    if (ownerErr) throw ownerErr;
    if (!owner) return res.status(404).json({ error: 'No encontramos tu ficha de propietario.' });

    const { data: prop, error: propErr } = await supabase
      .from('properties').select('id').eq('id', property_id).eq('owner_id', owner.id).maybeSingle();
    if (propErr) throw propErr;
    if (!prop) return res.status(403).json({ error: 'Esa propiedad no te pertenece.' });

    const images = await uploadReportImages(req.files);
    const { data, error } = await supabase.from('repairs').insert([{
      property_id: prop.id, type: 'incidencia', status: 'reportado',
      title, notes: notes || '', date_reported: new Date().toISOString().slice(0, 10),
      payer: 'propietario', images, reporter_email: email,
    }]).select().single();
    if (error) throw error;
    res.status(201).json({ ok: true, repair: data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al enviar tu reclamo. Probá de nuevo en un momento.' });
  }
});

// El propietario ve online su propio detalle de pago (alquiler cobrado menos
// la comisión del servicio, por cada una de sus propiedades).
const { buildOwnerDetailItems, buildOwnerDetailHtml, getSiteConfig, getPaymentDetailNotes, getPaymentDetailHeaderLines } = require('../paymentDetail');
router.get('/payment-detail', requireAuth, async (req, res) => {
  try {
    const email = req.user.email;
    const { data: owner } = await supabase.from('owners').select('*').eq('email', email).maybeSingle();
    if (!owner) return res.json({ isOwner: false });

    const items = await buildOwnerDetailItems(owner);
    const total = items.reduce((s, i) => s + i.net, 0);
    const config = await getSiteConfig();
    const footerNotes = await getPaymentDetailNotes();
    const headerLines = await getPaymentDetailHeaderLines();
    const html = buildOwnerDetailHtml({ ownerName: owner.name, items, config, footerNotes, headerLines });
    res.json({ isOwner: true, items, total, html });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al buscar tu detalle de pago.' });
  }
});

module.exports = router;
