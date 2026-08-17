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
  const rent = Number(b.rent) || 0;
  const commission = Number(b.commission) || 0;
  const expensas = Number(b.expensas) || 0;
  const repairs = Number(b.repairs) || 0;
  const fees = Number(b.fees) || 0;
  const net = rent - commission - expensas - repairs - fees;
  const { data, error } = await supabase.from('settlements').insert([{
    tenant_id: b.tenant_id, period: b.period, rent, commission, expensas, repairs, fees, net,
    transferred: false, transfer_date: null, notes: b.notes || '', payment_methods: [],
  }]).select().single();
  if (error) return res.status(500).json({ error: 'Error al crear la liquidación.' });
  res.status(201).json(data);
});

router.put('/:id', requireAuth, async (req, res) => {
  const b = req.body;
  const { data: current } = await supabase.from('settlements').select('*').eq('id', req.params.id).maybeSingle();
  if (!current) return res.status(404).json({ error: 'No encontramos esa liquidación.' });

  const updates = {};
  ['period', 'notes', 'transfer_date'].forEach(f => { if (b[f] !== undefined) updates[f] = b[f]; });
  if (b.transferred !== undefined) updates.transferred = !!b.transferred;
  if (b.payment_methods !== undefined) updates.payment_methods = b.payment_methods;

  // Si cambia algún monto, recalcula el neto.
  const montoFields = ['rent', 'commission', 'expensas', 'repairs', 'fees'];
  let recompute = false;
  montoFields.forEach(f => { if (b[f] !== undefined) { updates[f] = Number(b[f]) || 0; recompute = true; } });
  if (recompute) {
    const rent = updates.rent !== undefined ? updates.rent : current.rent;
    const commission = updates.commission !== undefined ? updates.commission : current.commission;
    const expensas = updates.expensas !== undefined ? updates.expensas : current.expensas;
    const repairs = updates.repairs !== undefined ? updates.repairs : current.repairs;
    const fees = updates.fees !== undefined ? updates.fees : current.fees;
    updates.net = rent - commission - expensas - repairs - fees;
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
