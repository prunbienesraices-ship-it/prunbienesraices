// routes/repairs.routes.js
const express = require('express');
const supabase = require('../supabaseClient');
const { requireAuth } = require('../auth');
const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('repairs').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Error al buscar reparaciones.' });
  res.json(data);
});
router.post('/', requireAuth, async (req, res) => {
  const b = req.body;
  const { data, error } = await supabase.from('repairs').insert([{
    property_id: b.property_id, type: b.type || 'incidencia', status: b.status || 'reportado', title: b.title,
    date_reported: b.date_reported || null, date_resolved: b.date_resolved || null,
    budgets: b.budgets || [], provider: b.provider || '', provider_phone: b.provider_phone || '',
    cost: Number(b.cost) || 0, payer: b.payer || 'propietario', warranty: b.warranty || '',
    invoice_number: b.invoice_number || '', notes: b.notes || '',
  }]).select().single();
  if (error) return res.status(500).json({ error: 'Error al crear la reparación.' });
  res.status(201).json(data);
});
router.put('/:id', requireAuth, async (req, res) => {
  const b = req.body;
  const updates = {};
  ['property_id','type','status','title','date_reported','date_resolved','provider','provider_phone','payer','warranty','invoice_number','notes'].forEach(f=>{ if(b[f]!==undefined) updates[f]=b[f]; });
  if(b.cost!==undefined) updates.cost = Number(b.cost);
  if(b.budgets!==undefined) updates.budgets = b.budgets;
  const { data, error } = await supabase.from('repairs').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: 'Error al editar la reparación.' });
  res.json(data);
});
router.delete('/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('repairs').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Error al borrar la reparación.' });
  res.json({ ok: true });
});
module.exports = router;
