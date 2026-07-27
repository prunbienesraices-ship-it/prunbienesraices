// routes/settlements.routes.js
const express = require('express');
const supabase = require('../supabaseClient');
const { requireAuth } = require('../auth');
const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('settlements').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Error al buscar liquidaciones.' });
  res.json(data);
});
router.post('/', requireAuth, async (req, res) => {
  const b = req.body;
  const net = (Number(b.rent)||0) - (Number(b.commission)||0) - (Number(b.expensas)||0) - (Number(b.repairs)||0) - (Number(b.fees)||0);
  const { data, error } = await supabase.from('settlements').insert([{
    tenant_id: b.tenant_id, period: b.period, rent: Number(b.rent)||0, commission: Number(b.commission)||0,
    expensas: Number(b.expensas)||0, repairs: Number(b.repairs)||0, repairs_desc: b.repairs_desc||'',
    fees: Number(b.fees)||0, fees_desc: b.fees_desc||'', net, transferred: false, notes: b.notes||'',
  }]).select().single();
  if (error) return res.status(500).json({ error: 'Error al crear la liquidación.' });
  res.status(201).json(data);
});
router.put('/:id', requireAuth, async (req, res) => {
  const b = req.body;
  const updates = {};
  ['period','repairs_desc','fees_desc','notes','transfer_date'].forEach(f=>{ if(b[f]!==undefined) updates[f]=b[f]; });
  ['rent','commission','expensas','repairs','fees'].forEach(f=>{ if(b[f]!==undefined) updates[f]=Number(b[f]); });
  if(b.transferred!==undefined) updates.transferred = !!b.transferred;
  if(['rent','commission','expensas','repairs','fees'].some(f=>b[f]!==undefined)){
    const { data: existing } = await supabase.from('settlements').select('*').eq('id', req.params.id).maybeSingle();
    const merged = { ...existing, ...updates };
    updates.net = (Number(merged.rent)||0) - (Number(merged.commission)||0) - (Number(merged.expensas)||0) - (Number(merged.repairs)||0) - (Number(merged.fees)||0);
  }
  const { data, error } = await supabase.from('settlements').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: 'Error al editar la liquidación.' });
  res.json(data);
});
router.delete('/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('settlements').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Error al borrar la liquidación.' });
  res.json({ ok: true });
});
module.exports = router;
