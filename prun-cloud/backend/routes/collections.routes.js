// routes/collections.routes.js
const express = require('express');
const supabase = require('../supabaseClient');
const { requireAuth } = require('../auth');
const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('collections_charges').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Error al buscar cobranzas.' });
  res.json(data);
});
router.post('/', requireAuth, async (req, res) => {
  const b = req.body;
  const { data, error } = await supabase.from('collections_charges').insert([{
    tenant_id: b.tenant_id, concept: b.concept, label: b.label || '', amount: Number(b.amount) || 0, payments: b.payments || [],
    due_date: b.due_date || null, late_coefficient: Number(b.late_coefficient) || 0,
  }]).select().single();
  if (error) return res.status(500).json({ error: 'Error al crear el cargo.' });
  res.status(201).json(data);
});
router.put('/:id', requireAuth, async (req, res) => {
  const b = req.body;
  const updates = {};
  ['concept','label','payments','due_date'].forEach(f=>{ if(b[f]!==undefined) updates[f]=b[f]; });
  if(b.amount!==undefined) updates.amount = Number(b.amount);
  if(b.late_coefficient!==undefined) updates.late_coefficient = Number(b.late_coefficient) || 0;
  const { data, error } = await supabase.from('collections_charges').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: 'Error al editar el cargo.' });
  res.json(data);
});
router.delete('/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('collections_charges').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Error al borrar el cargo.' });
  res.json({ ok: true });
});
module.exports = router;
