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

    function addMovement(accountId, tipo, origen, monto, fecha, detalle) {
      const key = accountId && accountMap[accountId] ? accountId : SIN_CUENTA;
      const signedAmount = tipo === 'entrada' ? monto : -monto;
      accountMap[key].balance += signedAmount;
      accountMap[key].movements.push({ tipo, origen, monto, fecha, detalle });
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

module.exports = router;
