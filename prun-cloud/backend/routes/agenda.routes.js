// routes/agenda.routes.js
const express = require('express');
const supabase = require('../supabaseClient');
const { requireAuth } = require('../auth');
const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('agenda_events').select('*').order('date', { ascending: true });
  if (error) return res.status(500).json({ error: 'Error al buscar la agenda.' });
  res.json(data);
});
router.post('/', requireAuth, async (req, res) => {
  const b = req.body;
  const { data, error } = await supabase.from('agenda_events').insert([{
    type: b.type, title: b.title, date: b.date, time: b.time || '', property_id: b.property_id || null,
    notes: b.notes || '', status: b.status || 'pendiente',
  }]).select().single();
  if (error) return res.status(500).json({ error: 'Error al crear el evento.' });
  res.status(201).json(data);
});
router.put('/:id', requireAuth, async (req, res) => {
  const b = req.body;
  const updates = {};
  ['type','title','date','time','property_id','notes','status'].forEach(f=>{ if(b[f]!==undefined) updates[f]=b[f]; });
  const { data, error } = await supabase.from('agenda_events').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: 'Error al editar el evento.' });
  res.json(data);
});
router.delete('/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('agenda_events').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Error al borrar el evento.' });
  res.json({ ok: true });
});
module.exports = router;
