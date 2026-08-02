// routes/payments.routes.js
const express = require('express');
const supabase = require('../supabaseClient');
const { requireAuth } = require('../auth');

const router = express.Router();

// Listar todos los comprobantes de pago que los inquilinos fueron cargando,
// para que el equipo tenga un registro completo. Se puede filtrar por
// propiedad con ?property_id=
router.get('/', requireAuth, async (req, res) => {
  let query = supabase.from('payment_receipts').select('*').order('created_at', { ascending: false });
  if (req.query.property_id) query = query.eq('property_id', req.query.property_id);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: 'Error al buscar los comprobantes de pago.' });
  res.json(data);
});

router.delete('/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('payment_receipts').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Error al borrar el comprobante.' });
  res.json({ ok: true });
});

module.exports = router;
