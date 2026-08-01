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
router.put('/', requireSuperadmin, upload.single('hero_image'), async (req, res) => {
  try {
    const b = req.body;
    const updates = {};
    ['logo_text', 'hero_title', 'hero_subtitle', 'footer_text', 'contact_phone', 'contact_email', 'whatsapp_number', 'primary_color']
      .forEach(f => { if (b[f] !== undefined) updates[f] = b[f]; });

    if (req.file) {
      const fileName = `hero-${Date.now()}.${req.file.originalname.split('.').pop()}`;
      const { error: uploadErr } = await supabase.storage.from('property-photos').upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
      });
      if (uploadErr) throw uploadErr;
      const { data: pub } = supabase.storage.from('property-photos').getPublicUrl(fileName);
      updates.hero_image = pub.publicUrl;
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

module.exports = router;
