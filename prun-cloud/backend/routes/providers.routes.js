// routes/providers.routes.js
const express = require('express');
const supabase = require('../supabaseClient');
const { requireAuth } = require('../auth');
const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('providers').select('*').order('favorite', { ascending: false });
  if (error) return res.status(500).json({ error: 'Error al buscar proveedores.' });
  res.json(data);
});
router.post('/', requireAuth, async (req, res) => {
  const b = req.body;
  const { data, error } = await supabase.from('providers').insert([{
    category: b.category, name: b.name, phone: b.phone || '', email: b.email || '',
    address: b.address || '', notes: b.notes || '', favorite: !!b.favorite,
  }]).select().single();
  if (error) return res.status(500).json({ error: 'Error al crear el proveedor.' });
  res.status(201).json(data);
});
router.put('/:id', requireAuth, async (req, res) => {
  const b = req.body;
  const updates = {};
  ['category','name','phone','email','address','notes'].forEach(f=>{ if(b[f]!==undefined) updates[f]=b[f]; });
  if(b.favorite!==undefined) updates.favorite = !!b.favorite;
  const { data, error } = await supabase.from('providers').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: 'Error al editar el proveedor.' });
  res.json(data);
});
router.delete('/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('providers').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Error al borrar el proveedor.' });
  res.json({ ok: true });
});
module.exports = router;
