// routes/guarantors.routes.js
const express = require('express');
const supabase = require('../supabaseClient');
const { requireAuth } = require('../auth');
const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('guarantors').select('*').order('name', { ascending: true });
  if (error) return res.status(500).json({ error: 'Error al buscar garantes.' });
  res.json(data);
});

router.post('/', requireAuth, async (req, res) => {
  const b = req.body;
  const { data, error } = await supabase.from('guarantors').insert([{
    name: b.name, dni: b.dni || '', address: b.address || '', phone: b.phone || '',
    email: b.email || '', notes: b.notes || '',
  }]).select().single();
  if (error) return res.status(500).json({ error: 'Error al crear el garante. ¿Ya existe otro garante con ese DNI?' });
  res.status(201).json(data);
});

router.put('/:id', requireAuth, async (req, res) => {
  const b = req.body;
  const updates = {};
  ['name', 'dni', 'address', 'phone', 'email', 'notes'].forEach(f => { if (b[f] !== undefined) updates[f] = b[f]; });
  const { data, error } = await supabase.from('guarantors').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: 'Error al editar el garante.' });
  res.json(data);
});

router.delete('/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('guarantors').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Error al borrar el garante.' });
  res.json({ ok: true });
});

// Crea o actualiza un garante a partir de su DNI (si ya existe uno con ese
// DNI, lo actualiza en vez de duplicarlo). La usa el formulario de contrato
// del inquilino para mantener la lista de Garantes siempre al día, sin que
// haga falta cargar cada garante dos veces a mano.
router.post('/upsert-by-dni', requireAuth, async (req, res) => {
  const b = req.body;
  if (!b.dni) return res.status(400).json({ error: 'Falta el DNI del garante.' });
  const { data: existing } = await supabase.from('guarantors').select('id').eq('dni', b.dni).maybeSingle();
  if (existing) {
    const { data, error } = await supabase.from('guarantors').update({
      name: b.name, address: b.address || '', phone: b.phone || '', email: b.email || '',
    }).eq('id', existing.id).select().single();
    if (error) return res.status(500).json({ error: 'Error al actualizar el garante.' });
    return res.json(data);
  }
  const { data, error } = await supabase.from('guarantors').insert([{
    name: b.name, dni: b.dni, address: b.address || '', phone: b.phone || '', email: b.email || '',
  }]).select().single();
  if (error) return res.status(500).json({ error: 'Error al crear el garante.' });
  res.status(201).json(data);
});

module.exports = router;
