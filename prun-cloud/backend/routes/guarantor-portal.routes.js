// routes/guarantor-portal.routes.js
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

// Busca las propiedades que este garante garantiza: mira su DNI (de su
// ficha de garante) y busca entre todos los inquilinos cuáles lo tienen
// cargado en su lista de garantes.
async function findGuaranteedProperties(email) {
  const { data: guarantor } = await supabase.from('guarantors').select('*').eq('email', email).maybeSingle();
  if (!guarantor || !guarantor.dni) return { guarantor: null, properties: [], tenants: [] };

  const { data: allTenants } = await supabase.from('tenants').select('*');
  const matchingTenants = (allTenants || []).filter(t =>
    (t.guarantors || []).some(g => g.dni && g.dni.replace(/\D/g, '') === guarantor.dni.replace(/\D/g, ''))
  );
  const propertyIds = [...new Set(matchingTenants.map(t => t.property_id))];
  let properties = [];
  if (propertyIds.length) {
    const { data } = await supabase.from('properties').select('*').in('id', propertyIds);
    properties = data || [];
  }
  return { guarantor, properties, tenants: matchingTenants };
}

// El garante logueado ve las propiedades que garantiza y los reclamos de esas propiedades.
router.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const { guarantor, properties, tenants } = await findGuaranteedProperties(req.user.email);
    if (!guarantor) return res.json({ isGuarantor: false, properties: [], repairs: [] });

    const propertyIds = properties.map(p => p.id);
    let repairs = [];
    if (propertyIds.length) {
      const { data } = await supabase.from('repairs').select('*').in('property_id', propertyIds).order('created_at', { ascending: false });
      repairs = data || [];
    }
    res.json({ isGuarantor: true, guarantor, properties, repairs, tenants: tenants.map(t => ({ id: t.id, name: t.name, property_id: t.property_id })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al buscar tu información como garante.' });
  }
});

// El garante puede cargar un reclamo nuevo, solo sobre una propiedad que
// efectivamente garantiza.
router.post('/report', requireAuth, upload.array('images', 5), async (req, res) => {
  try {
    const { property_id, title, notes } = req.body;
    if (!title) return res.status(400).json({ error: 'Contanos qué hay que reparar.' });

    const { properties } = await findGuaranteedProperties(req.user.email);
    const prop = properties.find(p => p.id === Number(property_id));
    if (!prop) return res.status(403).json({ error: 'Esa propiedad no está entre las que garantizás.' });

    const images = await uploadReportImages(req.files);
    const { data, error } = await supabase.from('repairs').insert([{
      property_id: prop.id, type: 'incidencia', status: 'reportado',
      title, notes: notes || '', date_reported: new Date().toISOString().slice(0, 10),
      payer: 'a definir', images, reporter_email: req.user.email,
    }]).select().single();
    if (error) throw error;
    res.status(201).json({ ok: true, repair: data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al enviar tu reclamo. Probá de nuevo en un momento.' });
  }
});

// El garante ve los comprobantes que subió, de las propiedades que garantiza.
router.get('/payments', requireAuth, async (req, res) => {
  try {
    const { guarantor, properties } = await findGuaranteedProperties(req.user.email);
    if (!guarantor) return res.json({ isGuarantor: false, payments: [] });
    const propertyIds = properties.map(p => p.id);
    let payments = [];
    if (propertyIds.length) {
      const { data } = await supabase.from('payment_receipts').select('*').in('property_id', propertyIds).eq('tenant_email', req.user.email).order('created_at', { ascending: false });
      payments = data || [];
    }
    res.json({ isGuarantor: true, payments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al buscar tus comprobantes.' });
  }
});

// Subir un comprobante de pago, eligiendo a cuál propiedad que garantiza corresponde.
router.post('/payments', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const { property_id, concept, amount, period, notes } = req.body;
    if (!concept) return res.status(400).json({ error: 'Contanos de qué es el pago.' });
    if (!req.file) return res.status(400).json({ error: 'Adjuntá el comprobante de pago.' });

    const { guarantor, properties } = await findGuaranteedProperties(req.user.email);
    if (!guarantor) return res.status(404).json({ error: 'No encontramos tu ficha de garante.' });
    const prop = properties.find(p => p.id === Number(property_id));
    if (!prop) return res.status(403).json({ error: 'Esa propiedad no está entre las que garantizás.' });

    const fileName = `comprobante-${Date.now()}-${Math.random().toString(36).slice(2,8)}.${req.file.originalname.split('.').pop()}`;
    const { error: uploadErr } = await supabase.storage.from('property-photos').upload(fileName, req.file.buffer, { contentType: req.file.mimetype });
    if (uploadErr) throw uploadErr;
    const { data: pub } = supabase.storage.from('property-photos').getPublicUrl(fileName);

    const { data, error } = await supabase.from('payment_receipts').insert([{
      property_id: prop.id, tenant_email: req.user.email, tenant_name: guarantor.name || '',
      concept, amount: Number(amount) || 0, period: period || '', file_url: pub.publicUrl, notes: notes || '',
    }]).select().single();
    if (error) throw error;
    res.status(201).json({ ok: true, payment: data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al subir el comprobante. Probá de nuevo en un momento.' });
  }
});

module.exports = router;
