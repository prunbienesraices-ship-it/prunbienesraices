// routes/deals.routes.js
const express = require('express');
const supabase = require('../supabaseClient');
const { requireAuth } = require('../auth');
const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('deals').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Error al buscar el pipeline.' });
  res.json(data);
});
router.post('/', requireAuth, async (req, res) => {
  const b = req.body;
  const { data, error } = await supabase.from('deals').insert([{
    property_id: b.property_id || null, name: b.name, phone: b.phone || '', email: b.email || '',
    amount: Number(b.amount) || 0, agent: b.agent || '', stage: b.stage || 'lead', notes: b.notes || '',
    history: b.history || [],
  }]).select().single();
  if (error) return res.status(500).json({ error: 'Error al crear el lead.' });
  res.status(201).json(data);
});
router.put('/:id', requireAuth, async (req, res) => {
  const b = req.body;
  const updates = {};
  ['property_id','name','phone','email','agent','stage','notes','history'].forEach(f=>{ if(b[f]!==undefined) updates[f]=b[f]; });
  if(b.amount!==undefined) updates.amount = Number(b.amount);
  const { data, error } = await supabase.from('deals').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: 'Error al editar el lead.' });
  res.json(data);
});
router.delete('/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('deals').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Error al borrar el lead.' });
  res.json({ ok: true });
});
module.exports = router;
