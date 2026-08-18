// routes/caja.routes.js
const express = require('express');
const supabase = require('../supabaseClient');
const { requireAuth } = require('../auth');
const router = express.Router();

// Junta TODOS los movimientos de plata del sistema (cobros de alquiler,
// otros conceptos, liquidaciones pagadas a propietarios, pagos de obra, y
// pagos a proveedores por reparaciones), agrupados por cuenta (banco,
// cooperativa, efectivo, o la que se haya cargado), con el saldo actual de
// cada una (saldo inicial + entradas - salidas).
router.get('/', requireAuth, async (req, res) => {
  try {
    const { data: accounts } = await supabase.from('bank_accounts').select('*').order('name', { ascending: true });
    const accountMap = {};
    (accounts || []).forEach(a => { accountMap[a.id] = { ...a, balance: Number(a.saldo_inicial) || 0, movements: [] }; });
    // "Sin cuenta" agrupa los movimientos viejos que no tenían cuenta asignada.
    const SIN_CUENTA = 'sin_cuenta';
    accountMap[SIN_CUENTA] = { id: SIN_CUENTA, name: 'Sin cuenta asignada', account_type: '-', balance: 0, movements: [] };

    function addMovement(accountId, tipo, origen, monto, fecha, detalle, movId) {
      const key = accountId && accountMap[accountId] ? accountId : SIN_CUENTA;
      const signedAmount = tipo === 'entrada' ? monto : -monto;
      accountMap[key].balance += signedAmount;
      accountMap[key].movements.push({ tipo, origen, monto, fecha, detalle, movId: movId || null });
    }

    // --- Cobros de alquiler ---
    const { data: tenants } = await supabase.from('tenants').select('id, name, payments');
    (tenants || []).forEach(t => {
      (t.payments || []).forEach(p => {
        if (!p.amount) return;
        addMovement(p.account_id, 'entrada', 'Alquiler', Number(p.amount), p.date, `${t.name} — ${p.period || ''} (${p.method || ''})`);
      });
    });

    // --- Cobros de otros conceptos ---
    const { data: charges } = await supabase.from('collections_charges').select('*, tenant_id');
    const tenantNameById = {}; (tenants || []).forEach(t => { tenantNameById[t.id] = t.name; });
    (charges || []).forEach(c => {
      (c.payments || []).forEach(p => {
        if (!p.amount) return;
        addMovement(p.account_id, 'entrada', 'Otros cobros', Number(p.amount), p.date, `${tenantNameById[c.tenant_id] || '-'} — ${c.concept} (${p.method || ''})`);
      });
    });

    // --- Liquidaciones pagadas a propietarios (salida) ---
    const { data: settlements } = await supabase.from('settlements').select('*');
    (settlements || []).forEach(s => {
      (s.payment_methods || []).forEach(pm => {
        if (!pm.amount) return;
        addMovement(pm.account_id, 'salida', 'Liquidación propietario', Number(pm.amount), s.transfer_date, `${tenantNameById[s.tenant_id] || '-'} — ${s.period} (${pm.method || ''})`);
      });
    });

    // --- Pagos de obra (salida) ---
    const { data: obras } = await supabase.from('obras').select('id, nombre');
    const obraNameById = {}; (obras || []).forEach(o => { obraNameById[o.id] = o.nombre; });
    const { data: obraPagos } = await supabase.from('obra_pagos').select('*');
    (obraPagos || []).forEach(p => {
      if (!p.monto) return;
      addMovement(p.account_id, 'salida', 'Obra', Number(p.monto), p.fecha, `${obraNameById[p.obra_id] || '-'} — ${p.destino}: ${p.concepto || ''} (${p.metodo || ''})`);
    });

    // --- Pagos a proveedores por reparaciones (salida) ---
    const { data: repairs } = await supabase.from('repairs').select('*');
    (repairs || []).forEach(r => {
      (r.payments || []).forEach(p => {
        if (!p.amount) return;
        addMovement(p.account_id, 'salida', 'Proveedor / Reparación', Number(p.amount), p.date, `${r.title} — ${r.provider || 'proveedor'} (${p.method || ''})`);
      });
    });

    // --- Movimientos sueltos cargados a mano (ej: publicidad, gastos varios) ---
    const { data: manuales } = await supabase.from('caja_movimientos').select('*');
    (manuales || []).forEach(m => {
      if (!m.monto) return;
      addMovement(m.account_id, m.tipo, 'Movimiento manual', Number(m.monto), m.fecha, `${m.concepto}${m.notes ? ' — ' + m.notes : ''}`, m.id);
    });

    // Ordena los movimientos de cada cuenta del más reciente al más viejo.
    Object.values(accountMap).forEach(acc => {
      acc.movements.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    });

    res.json({ accounts: Object.values(accountMap) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al armar la Caja.' });
  }
});

// Carga un movimiento suelto a mano (ej: gasto de publicidad, un ingreso
// que no viene de ningún otro lado del sistema).
router.post('/movimiento', requireAuth, async (req, res) => {
  const b = req.body;
  if (!b.concepto) return res.status(400).json({ error: 'Contanos de qué es el movimiento.' });
  if (!b.monto) return res.status(400).json({ error: 'Cargá un monto.' });
  const { data, error } = await supabase.from('caja_movimientos').insert([{
    account_id: b.account_id || null, tipo: b.tipo === 'entrada' ? 'entrada' : 'salida',
    concepto: b.concepto, monto: Number(b.monto) || 0, fecha: b.fecha || new Date().toISOString().slice(0, 10),
    notes: b.notes || '',
  }]).select().single();
  if (error) return res.status(500).json({ error: 'Error al cargar el movimiento.' });
  res.status(201).json(data);
});

router.delete('/movimiento/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('caja_movimientos').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Error al borrar el movimiento.' });
  res.json({ ok: true });
});

module.exports = router;
