// routes/expensas.routes.js
const express = require('express');
const multer = require('multer');
const supabase = require('../supabaseClient');
const { requireAuth } = require('../auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Listar expensas (panel interno). Se puede filtrar por edificio con ?development_id=
router.get('/', requireAuth, async (req, res) => {
  let query = supabase.from('expensas').select('*').order('period', { ascending: false });
  if (req.query.development_id) query = query.eq('development_id', req.query.development_id);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: 'Error al buscar las expensas.' });
  res.json(data);
});

// Crear una liquidación de expensas para un edificio y periodo, con sus facturas adjuntas.
router.post('/', requireAuth, upload.array('invoices', 15), async (req, res) => {
  try {
    const b = req.body;
    let invoiceUrls = [];
    if (req.files && req.files.length) {
      for (const file of req.files) {
        const fileName = `expensa-${Date.now()}-${Math.random().toString(36).slice(2,8)}.${file.originalname.split('.').pop()}`;
        const { error: uploadErr } = await supabase.storage.from('property-photos').upload(fileName, file.buffer, { contentType: file.mimetype });
        if (uploadErr) throw uploadErr;
        const { data: pub } = supabase.storage.from('property-photos').getPublicUrl(fileName);
        invoiceUrls.push({ name: file.originalname, url: pub.publicUrl });
      }
    }

    const { data, error } = await supabase.from('expensas').insert([{
      development_id: Number(b.development_id),
      period: b.period,
      total_amount: Number(b.total_amount) || 0,
      detail: b.detail ? JSON.parse(b.detail) : [],
      invoices: invoiceUrls,
      notes: b.notes || '',
    }]).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar las expensas.' });
  }
});

// Editar (puede agregar mas facturas sin borrar las anteriores)
router.put('/:id', requireAuth, upload.array('invoices', 15), async (req, res) => {
  try {
    const b = req.body;
    const { data: existing, error: findErr } = await supabase.from('expensas').select('invoices').eq('id', req.params.id).single();
    if (findErr) throw findErr;

    let invoiceUrls = existing.invoices || [];
    if (req.files && req.files.length) {
      for (const file of req.files) {
        const fileName = `expensa-${Date.now()}-${Math.random().toString(36).slice(2,8)}.${file.originalname.split('.').pop()}`;
        const { error: uploadErr } = await supabase.storage.from('property-photos').upload(fileName, file.buffer, { contentType: file.mimetype });
        if (uploadErr) throw uploadErr;
        const { data: pub } = supabase.storage.from('property-photos').getPublicUrl(fileName);
        invoiceUrls.push({ name: file.originalname, url: pub.publicUrl });
      }
    }

    const updates = { invoices: invoiceUrls };
    if (b.period !== undefined) updates.period = b.period;
    if (b.total_amount !== undefined) updates.total_amount = Number(b.total_amount);
    if (b.detail !== undefined) updates.detail = JSON.parse(b.detail);
    if (b.notes !== undefined) updates.notes = b.notes;

    const { data, error } = await supabase.from('expensas').update(updates).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar las expensas.' });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('expensas').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Error al borrar.' });
  res.json({ ok: true });
});

module.exports = router;
