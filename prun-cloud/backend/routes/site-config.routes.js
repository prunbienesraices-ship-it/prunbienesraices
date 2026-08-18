// routes/site-config.routes.js
const express = require('express');
const multer = require('multer');
const supabase = require('../supabaseClient');
const { requireAuth, requireSuperadmin } = require('../auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Publico: el sitio lee esta configuracion para pintar textos, colores e imagen.
router.get('/', async (req, res) => {
  const { data, error } = await supabase.from('site_config').select('*').eq('id', 1).maybeSingle();
  if (error) return res.status(500).json({ error: 'Error al buscar la configuración del sitio.' });
  res.json(data || {});
});

// Solo el superadmin puede modificarla; el resto del personal no.
router.put('/', requireSuperadmin, upload.fields([{ name: 'hero_image', maxCount: 1 }, { name: 'logo_image', maxCount: 1 }]), async (req, res) => {
  try {
    const b = req.body;
    const updates = {};
    ['logo_text', 'hero_title', 'hero_subtitle', 'footer_text', 'contact_phone', 'contact_email', 'office_address', 'whatsapp_number', 'primary_color']
      .forEach(f => { if (b[f] !== undefined) updates[f] = b[f]; });
    if (b.payment_reminders_enabled !== undefined) updates.payment_reminders_enabled = b.payment_reminders_enabled === 'true' || b.payment_reminders_enabled === true;
    if (b.renewal_reminders_enabled !== undefined) updates.renewal_reminders_enabled = b.renewal_reminders_enabled === 'true' || b.renewal_reminders_enabled === true;

    const files = req.files || {};
    if (files.hero_image && files.hero_image[0]) {
      const file = files.hero_image[0];
      const fileName = `hero-${Date.now()}.${file.originalname.split('.').pop()}`;
      const { error: uploadErr } = await supabase.storage.from('property-photos').upload(fileName, file.buffer, { contentType: file.mimetype });
      if (uploadErr) throw uploadErr;
      const { data: pub } = supabase.storage.from('property-photos').getPublicUrl(fileName);
      updates.hero_image = pub.publicUrl;
    }
    if (files.logo_image && files.logo_image[0]) {
      const file = files.logo_image[0];
      const fileName = `logo-${Date.now()}.${file.originalname.split('.').pop()}`;
      const { error: uploadErr } = await supabase.storage.from('property-photos').upload(fileName, file.buffer, { contentType: file.mimetype });
      if (uploadErr) throw uploadErr;
      const { data: pub } = supabase.storage.from('property-photos').getPublicUrl(fileName);
      updates.logo_image = pub.publicUrl;
    }

    updates.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('site_config').update(updates).eq('id', 1).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar la configuración del sitio.' });
  }
});

// Disparar los avisos manualmente (para probar que funcionen, sin esperar
// al chequeo automático). Solo el Administrador.
router.post('/run-payment-reminders', requireSuperadmin, async (req, res) => {
  try {
    const { runPaymentReminders } = require('../reminders');
    const result = await runPaymentReminders();
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al correr los avisos de pago.' });
  }
});
router.post('/run-renewal-reminders', requireSuperadmin, async (req, res) => {
  try {
    const { runRenewalReminders } = require('../reminders');
    const result = await runRenewalReminders();
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al correr los avisos de renovación.' });
  }
});

module.exports = router;
