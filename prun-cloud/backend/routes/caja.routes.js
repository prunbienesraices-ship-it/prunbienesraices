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

    // Nota: los pagos de Control de Obra NO se reflejan en Caja (a pedido).

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

    const { data: cierres } = await supabase.from('caja_cierres').select('*').order('period', { ascending: false });

    res.json({ accounts: Object.values(accountMap), cierres: cierres || [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al armar la Caja.' });
  }
});

const STAFF_SUPERADMIN = 'superadmin';

// Un mes cerrado no deja cargar/borrar movimientos MANUALES de ese período,
// salvo que quien lo pida sea el Administrador (que puede tocar cualquier
// mes, cerrado o no, cuando haga falta corregir algo).
async function periodoEstaCerrado(fecha) {
  if (!fecha) return false;
  const period = fecha.slice(0, 7); // "YYYY-MM"
  const { data } = await supabase.from('caja_cierres').select('id').eq('period', period).maybeSingle();
  return !!data;
}

// Carga un movimiento suelto a mano (ej: gasto de publicidad, un ingreso
// que no viene de ningún otro lado del sistema).
router.post('/movimiento', requireAuth, async (req, res) => {
  const b = req.body;
  if (!b.concepto) return res.status(400).json({ error: 'Contanos de qué es el movimiento.' });
  if (!b.monto) return res.status(400).json({ error: 'Cargá un monto.' });
  const fecha = b.fecha || new Date().toISOString().slice(0, 10);
  if (req.user.role !== STAFF_SUPERADMIN && await periodoEstaCerrado(fecha)) {
    return res.status(403).json({ error: 'Ese mes ya está cerrado — solo el Administrador puede cargar movimientos ahí.' });
  }
  const { data, error } = await supabase.from('caja_movimientos').insert([{
    account_id: b.account_id || null, tipo: b.tipo === 'entrada' ? 'entrada' : 'salida',
    concepto: b.concepto, monto: Number(b.monto) || 0, fecha, notes: b.notes || '',
  }]).select().single();
  if (error) return res.status(500).json({ error: 'Error al cargar el movimiento.' });
  res.status(201).json(data);
});

router.delete('/movimiento/:id', requireAuth, async (req, res) => {
  const { data: current } = await supabase.from('caja_movimientos').select('fecha').eq('id', req.params.id).maybeSingle();
  if (current && req.user.role !== STAFF_SUPERADMIN && await periodoEstaCerrado(current.fecha)) {
    return res.status(403).json({ error: 'Ese mes ya está cerrado — solo el Administrador puede borrar movimientos ahí.' });
  }
  const { error } = await supabase.from('caja_movimientos').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Error al borrar el movimiento.' });
  res.json({ ok: true });
});

// Cerrar / reabrir un mes — solo el Administrador.
router.post('/cerrar-mes', requireAuth, async (req, res) => {
  if (req.user.role !== STAFF_SUPERADMIN) return res.status(403).json({ error: 'Solo el Administrador puede cerrar un mes.' });
  const { period } = req.body;
  if (!/^\d{4}-\d{2}$/.test(period || '')) return res.status(400).json({ error: 'Formato de período inválido (tiene que ser AAAA-MM).' });
  const { data, error } = await supabase.from('caja_cierres').insert([{ period, closed_by: req.user.email || req.user.name || '' }]).select().single();
  if (error) return res.status(500).json({ error: 'Ese mes ya estaba cerrado, o hubo un error al cerrarlo.' });
  res.status(201).json(data);
});
router.delete('/cerrar-mes/:period', requireAuth, async (req, res) => {
  if (req.user.role !== STAFF_SUPERADMIN) return res.status(403).json({ error: 'Solo el Administrador puede reabrir un mes.' });
  const { error } = await supabase.from('caja_cierres').delete().eq('period', req.params.period);
  if (error) return res.status(500).json({ error: 'Error al reabrir el mes.' });
  res.json({ ok: true });
});

// Cierra automáticamente todos los meses pasados que todavía sigan
// abiertos (nunca el mes actual). Revisa desde el movimiento manual más
// viejo hasta el mes anterior al de hoy, así se pone al día solo aunque
// el servidor haya estado dormido varios meses sin uso.
async function autoCloseCajaPastMonths() {
  const now = new Date();
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const { data: cierres } = await supabase.from('caja_cierres').select('period');
  const closedSet = new Set((cierres || []).map(c => c.period));

  const { data: oldestMov } = await supabase.from('caja_movimientos').select('fecha').not('fecha', 'is', null).order('fecha', { ascending: true }).limit(1);
  let cursor;
  if (oldestMov && oldestMov.length) {
    const d = new Date(oldestMov[0].fecha + 'T00:00:00');
    cursor = new Date(d.getFullYear(), d.getMonth(), 1);
  } else {
    cursor = new Date(now.getFullYear(), now.getMonth() - 1, 1); // si no hay nada cargado, solo revisa el mes pasado
  }

  const cerradosAhora = [];
  while (true) {
    const period = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
    if (period >= currentPeriod) break; // nunca cierra el mes actual ni futuros
    if (!closedSet.has(period)) {
      const { error } = await supabase.from('caja_cierres').insert([{ period, closed_by: 'Automático (1° de mes)' }]);
      if (!error) cerradosAhora.push(period);
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  if (cerradosAhora.length) console.log(`Caja: se cerraron automáticamente los meses ${cerradosAhora.join(', ')}.`);
  return cerradosAhora;
}

module.exports = router;
module.exports.autoCloseCajaPastMonths = autoCloseCajaPastMonths;
