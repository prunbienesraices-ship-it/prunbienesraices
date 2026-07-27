// routes/developments.routes.js
const express = require('express');
const supabase = require('../supabaseClient');
const { requireAuth } = require('../auth');
const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('developments').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Error al buscar edificios.' });
  res.json(data);
});
router.post('/', requireAuth, async (req, res) => {
  const b = req.body;
  const { data, error } = await supabase.from('developments').insert([{
    name: b.name, type: b.type || 'edificio', city: b.city || '', address: b.address || '',
    units: Number(b.units) || 1, status: b.status || 'terminado', expenses: Number(b.expenses) || 0,
    amenities: b.amenities || [], description: b.description || '',
  }]).select().single();
  if (error) return res.status(500).json({ error: 'Error al crear el edificio.' });
  res.status(201).json(data);
});
router.put('/:id', requireAuth, async (req, res) => {
  const b = req.body;
  const updates = {};
  ['name','type','city','address','status','description'].forEach(f=>{ if(b[f]!==undefined) updates[f]=b[f]; });
  ['units','expenses'].forEach(f=>{ if(b[f]!==undefined) updates[f]=Number(b[f]); });
  if(b.amenities!==undefined) updates.amenities = b.amenities;
  const { data, error } = await supabase.from('developments').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: 'Error al editar el edificio.' });
  res.json(data);
});
router.delete('/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('developments').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Error al borrar el edificio.' });
  res.json({ ok: true });
});
module.exports = router;
