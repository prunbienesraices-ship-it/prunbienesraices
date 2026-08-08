// routes/payment-detail-template.routes.js
const express = require('express');
const supabase = require('../supabaseClient');
const { requireAuth, requireSuperadmin } = require('../auth');

const router = express.Router();

// Cualquiera del personal logueado puede ver el modelo (para saber que dice).
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('payment_detail_template').select('*').eq('id', 1).maybeSingle();
  if (error) return res.status(500).json({ error: 'Error al buscar el modelo de detalle de pago.' });
  res.json(data || {});
});

// Solo el Administrador puede editar las notas y el encabezado del detalle de pago.
router.put('/', requireSuperadmin, async (req, res) => {
  try {
    const { footer_notes, header_lines } = req.body;
    const updates = { updated_at: new Date().toISOString() };
    if (footer_notes !== undefined) updates.footer_notes = footer_notes;
    if (header_lines !== undefined) updates.header_lines = header_lines;

    const { data, error } = await supabase.from('payment_detail_template').update(updates).eq('id', 1).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar el modelo de detalle de pago.' });
  }
});

module.exports = router;
