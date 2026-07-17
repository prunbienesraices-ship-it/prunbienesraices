// routes/inquiries.routes.js
const express = require('express');
const supabase = require('../supabaseClient');
const { requireAuth } = require('../auth');

const router = express.Router();

// Enviar una consulta (publico)
router.post('/', async (req, res) => {
  try {
    const { name, email, phone, message, property_id } = req.body;
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Nombre, email y mensaje son obligatorios.' });
    }
    const { data, error } = await supabase.from('inquiries')
      .insert([{ name, email, phone: phone || '', message, property_id: property_id || null }])
      .select().single();
    if (error) throw error;
    res.status(201).json({ id: data.id, ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al enviar la consulta.' });
  }
});

// Listar consultas (solo admin)
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('inquiries').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Error al buscar las consultas.' });
  res.json(data);
});

// Marcar leida/no leida (solo admin)
router.put('/:id/read', requireAuth, async (req, res) => {
  const { error } = await supabase.from('inquiries').update({ is_read: !!req.body.is_read }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Error al actualizar la consulta.' });
  res.json({ ok: true });
});

// Borrar (solo admin)
router.delete('/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('inquiries').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Error al borrar la consulta.' });
  res.json({ ok: true });
});

module.exports = router;
