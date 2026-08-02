// routes/branches.routes.js
const express = require('express');
const supabase = require('../supabaseClient');
const { requireAuth, requireSuperadmin } = require('../auth');

const router = express.Router();

// Cualquiera del personal logueado puede ver la lista de sucursales
// (para poder elegirla al cargar una propiedad, por ejemplo).
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('branches').select('*').order('name', { ascending: true });
  if (error) return res.status(500).json({ error: 'Error al buscar las sucursales.' });
  res.json(data);
});

// Solo el administrador puede crear, editar o borrar sucursales.
router.post('/', requireSuperadmin, async (req, res) => {
  try {
    const { name, address, city, phone, email } = req.body;
    if (!name) return res.status(400).json({ error: 'Ingresá el nombre de la sucursal.' });
    const { data, error } = await supabase.from('branches')
      .insert([{ name, address: address || '', city: city || '', phone: phone || '', email: email || '' }])
      .select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear la sucursal.' });
  }
});

router.put('/:id', requireSuperadmin, async (req, res) => {
  try {
    const updates = {};
    ['name', 'address', 'city', 'phone', 'email'].forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
    const { data, error } = await supabase.from('branches').update(updates).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar la sucursal.' });
  }
});

router.delete('/:id', requireSuperadmin, async (req, res) => {
  const { error } = await supabase.from('branches').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Error al borrar la sucursal.' });
  res.json({ ok: true });
});

module.exports = router;
