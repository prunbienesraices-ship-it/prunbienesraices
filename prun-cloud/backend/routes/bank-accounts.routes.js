// routes/bank-accounts.routes.js
const express = require('express');
const supabase = require('../supabaseClient');
const { requireAuth } = require('../auth');
const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('bank_accounts').select('*').order('name', { ascending: true });
  if (error) return res.status(500).json({ error: 'Error al buscar las cuentas.' });
  res.json(data);
});

router.post('/', requireAuth, async (req, res) => {
  const b = req.body;
  if (!b.name) return res.status(400).json({ error: 'Ponele un nombre a la cuenta.' });
  const { data, error } = await supabase.from('bank_accounts').insert([{
    name: b.name, account_type: b.account_type || 'banco', notes: b.notes || '',
    saldo_inicial: Number(b.saldo_inicial) || 0,
  }]).select().single();
  if (error) return res.status(500).json({ error: 'Error al crear la cuenta.' });
  res.status(201).json(data);
});

router.put('/:id', requireAuth, async (req, res) => {
  const b = req.body;
  const updates = {};
  ['name', 'account_type', 'notes'].forEach(f => { if (b[f] !== undefined) updates[f] = b[f]; });
  if (b.saldo_inicial !== undefined) updates.saldo_inicial = Number(b.saldo_inicial) || 0;
  const { data, error } = await supabase.from('bank_accounts').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: 'Error al editar la cuenta.' });
  res.json(data);
});

router.delete('/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('bank_accounts').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Error al borrar la cuenta.' });
  res.json({ ok: true });
});

module.exports = router;
