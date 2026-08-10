// routes/reputation.routes.js
const express = require('express');
const supabase = require('../supabaseClient');
const { requireAuth } = require('../auth');
const { getMissingPayments, computeTenantStatus } = require('../paymentDetail');

const router = express.Router();

function normalizeDni(dni) { return (dni || '').replace(/\D/g, ''); }

// Junta todos los contratos (como inquilino) y apariciones (como garante)
// de una persona por su DNI, y calcula su puntualidad automáticamente en
// base a los pagos ya registrados (con su tramo real, no la fecha de carga).
async function computeReputation(dni) {
  const normalized = normalizeDni(dni);
  if (!normalized) return null;

  const { data: allTenants } = await supabase.from('tenants').select('*');
  const tenantContracts = (allTenants || []).filter(t => normalizeDni(t.dni) === normalized);

  const { data: allGuarantors } = await supabase.from('guarantors').select('*');
  const guarantorProfile = (allGuarantors || []).find(g => normalizeDni(g.dni) === normalized);

  // Cuántas veces esta persona (como garante) tuvo que cubrir un pago que
  // el inquilino no hizo, en CUALQUIER contrato donde figure como garante.
  const timesCoveredAsGuarantor = (allTenants || []).reduce((count, t) => {
    const isGuarantorHere = (t.guarantors || []).some(g => normalizeDni(g.dni) === normalized);
    if (!isGuarantorHere) return count;
    const coveredPayments = (t.payments || []).filter(p => p.paid_by === 'garante').length;
    return count + coveredPayments;
  }, 0);

  let aTiempo = 0, segundoVencimiento = 0, tercerVencimiento = 0, pagadoPorGarante = 0, totalPagosRegistrados = 0;
  let mesesPendientesActuales = 0;

  tenantContracts.forEach(t => {
    (t.payments || []).forEach(p => {
      totalPagosRegistrados++;
      if (p.tramo === 'a_tiempo') aTiempo++;
      else if (p.tramo === '2do_vencimiento') segundoVencimiento++;
      else if (p.tramo === '3er_vencimiento') tercerVencimiento++;
      if (p.paid_by === 'garante') pagadoPorGarante++;
    });
    if (computeTenantStatus(t) !== 'rescindido') {
      mesesPendientesActuales += getMissingPayments(t).length;
    }
  });

  // Semáforo resumen de puntualidad: se calcula solo, en base al historial.
  let puntualidadSemaforo = '⚪ Sin historial todavía';
  if (totalPagosRegistrados > 0) {
    const puntaje = (aTiempo * 3 + segundoVencimiento * 1 - tercerVencimiento * 2 - pagadoPorGarante * 3) / totalPagosRegistrados;
    if (mesesPendientesActuales > 0) puntualidadSemaforo = '🔴 Debe meses actualmente';
    else if (puntaje >= 2) puntualidadSemaforo = '🟢 Buen pagador';
    else if (puntaje >= 0) puntualidadSemaforo = '🟡 Pagador irregular';
    else puntualidadSemaforo = '🔴 Mal historial de pago';
  }

  const { data: notes } = await supabase.from('reputation_notes').select('*').eq('dni', normalized).order('created_at', { ascending: false });

  return {
    dni: normalized,
    name: tenantContracts[0]?.name || guarantorProfile?.name || null,
    isTenant: tenantContracts.length > 0,
    isGuarantor: !!guarantorProfile,
    contractsCount: tenantContracts.length,
    puntualidad: {
      aTiempo, segundoVencimiento, tercerVencimiento, pagadoPorGarante, totalPagosRegistrados,
      mesesPendientesActuales, timesCoveredAsGuarantor, semaforo: puntualidadSemaforo,
    },
    notes: notes || [],
  };
}

router.get('/:dni', requireAuth, async (req, res) => {
  try {
    const data = await computeReputation(req.params.dni);
    if (!data) return res.status(400).json({ error: 'DNI inválido.' });
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al calcular la reputación.' });
  }
});

// Agrega una nota manual (comunicación, cuidado de la propiedad, o general).
router.post('/:dni/note', requireAuth, async (req, res) => {
  try {
    const normalized = normalizeDni(req.params.dni);
    if (!normalized) return res.status(400).json({ error: 'DNI inválido.' });
    const { category, score, note } = req.body;
    if (!category) return res.status(400).json({ error: 'Falta la categoría de la nota.' });

    const { data, error } = await supabase.from('reputation_notes').insert([{
      dni: normalized, category, score: score ? Number(score) : null, note: note || '',
      created_by: req.user.email || req.user.name || '',
    }]).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar la nota.' });
  }
});

router.delete('/note/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('reputation_notes').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Error al borrar la nota.' });
  res.json({ ok: true });
});

module.exports = router;
