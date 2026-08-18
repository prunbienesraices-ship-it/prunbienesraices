// routes/obras.routes.js
const express = require('express');
const supabase = require('../supabaseClient');
const { requireAuth } = require('../auth');

const router = express.Router();

// ---------- OBRAS (lista y ficha) ----------
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('obras').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Error al buscar obras.' });
  res.json(data);
});

router.post('/', requireAuth, async (req, res) => {
  const b = req.body;
  const { data, error } = await supabase.from('obras').insert([{
    nombre: b.nombre || 'Nueva obra', property_id: b.property_id || null,
  }]).select().single();
  if (error) return res.status(500).json({ error: 'Error al crear la obra.' });
  res.status(201).json(data);
});

router.put('/:id', requireAuth, async (req, res) => {
  const b = req.body;
  const updates = {};
  ['nombre', 'property_id', 'presupuesto_albanil', 'presupuesto_electricista', 'presupuesto_gasista',
   'presupuesto_arquitecto', 'presupuesto_impuestos', 'presupuesto_luis_usd', 'presupuesto_luis_eur']
    .forEach(f => { if (b[f] !== undefined) updates[f] = b[f]; });
  const { data, error } = await supabase.from('obras').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: 'Error al editar la obra.' });
  res.json(data);
});

router.delete('/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('obras').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Error al borrar la obra.' });
  res.json({ ok: true });
});

// Trae todo lo de una obra de una sola vez (ficha + compras + retiros + pagos).
router.get('/:id/data', requireAuth, async (req, res) => {
  try {
    const { data: obra } = await supabase.from('obras').select('*').eq('id', req.params.id).maybeSingle();
    if (!obra) return res.status(404).json({ error: 'No encontramos esa obra.' });
    const { data: compras } = await supabase.from('obra_compras').select('*').eq('obra_id', req.params.id).order('fecha', { ascending: false });
    const { data: retiros } = await supabase.from('obra_retiros').select('*').eq('obra_id', req.params.id).order('fecha', { ascending: false });
    const { data: pagos } = await supabase.from('obra_pagos').select('*').eq('obra_id', req.params.id).order('fecha', { ascending: false });
    const { data: ajustes } = await supabase.from('obra_presupuesto_ajustes').select('*').eq('obra_id', req.params.id).order('fecha', { ascending: true });
    res.json({ obra, compras: compras || [], retiros: retiros || [], pagos: pagos || [], ajustes: ajustes || [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al buscar los datos de la obra.' });
  }
});

// ---------- AJUSTES DE PRESUPUESTO (historial de actualizaciones) ----------
// Cada categoria (gremio o Luis USD/EUR) puede tener varios ajustes cargados
// con su propia fecha, y el presupuesto total de esa categoria es la suma
// del monto inicial (cargado en la ficha) mas todos sus ajustes.
router.post('/:id/ajustes', requireAuth, async (req, res) => {
  const b = req.body;
  if (!b.categoria) return res.status(400).json({ error: 'Falta indicar a qué categoría corresponde el ajuste.' });
  const { data, error } = await supabase.from('obra_presupuesto_ajustes').insert([{
    obra_id: req.params.id, categoria: b.categoria, monto: Number(b.monto) || 0,
    fecha: b.fecha || null, nota: b.nota || '',
  }]).select().single();
  if (error) return res.status(500).json({ error: 'Error al agregar el ajuste de presupuesto.' });
  res.status(201).json(data);
});
router.delete('/ajustes/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('obra_presupuesto_ajustes').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Error al borrar el ajuste.' });
  res.json({ ok: true });
});

// ---------- COMPRAS ----------
router.post('/:id/compras', requireAuth, async (req, res) => {
  const b = req.body;
  const { data, error } = await supabase.from('obra_compras').insert([{
    obra_id: req.params.id, nombre: b.nombre, cantidad: Number(b.cantidad) || 0, unidad: b.unidad || '',
    costo_unit: Number(b.costoUnit) || 0, proveedor: b.proveedor || '', fecha: b.fecha || null,
  }]).select().single();
  if (error) return res.status(500).json({ error: 'Error al agregar la compra.' });
  res.status(201).json(data);
});
router.post('/:id/compras/bulk', requireAuth, async (req, res) => {
  const items = (req.body.items || []).map(b => ({
    obra_id: req.params.id, nombre: b.nombre, cantidad: Number(b.cantidad) || 0, unidad: b.unidad || '',
    costo_unit: Number(b.costoUnit) || 0, proveedor: b.proveedor || '', fecha: b.fecha || null,
  }));
  if (!items.length) return res.status(400).json({ error: 'Nada para cargar.' });
  const { data, error } = await supabase.from('obra_compras').insert(items).select();
  if (error) return res.status(500).json({ error: 'Error al cargar las compras.' });
  res.status(201).json(data);
});
router.delete('/compras/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('obra_compras').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Error al borrar la compra.' });
  res.json({ ok: true });
});

// ---------- RETIROS ----------
router.post('/:id/retiros', requireAuth, async (req, res) => {
  const b = req.body;
  const { data, error } = await supabase.from('obra_retiros').insert([{
    obra_id: req.params.id, material_nombre: b.materialNombre, cantidad: Number(b.cantidad) || 0,
    destino: b.destino || '', fecha: b.fecha || null,
  }]).select().single();
  if (error) return res.status(500).json({ error: 'Error al registrar el retiro.' });
  res.status(201).json(data);
});
router.delete('/retiros/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('obra_retiros').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Error al borrar el retiro.' });
  res.json({ ok: true });
});

// ---------- PAGOS ----------
router.post('/:id/pagos', requireAuth, async (req, res) => {
  const b = req.body;
  const { data, error } = await supabase.from('obra_pagos').insert([{
    obra_id: req.params.id, destino: b.destino, concepto: b.concepto || '', monto: Number(b.monto) || 0,
    metodo: b.metodo || '', fecha: b.fecha || null, moneda: b.moneda || 'ARS', account_id: b.account_id || null,
  }]).select().single();
  if (error) return res.status(500).json({ error: 'Error al registrar el pago.' });
  res.status(201).json(data);
});
router.delete('/pagos/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('obra_pagos').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Error al borrar el pago.' });
  res.json({ ok: true });
});

module.exports = router;
