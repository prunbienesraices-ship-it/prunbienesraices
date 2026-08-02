// routes/contract-template.routes.js
const express = require('express');
const supabase = require('../supabaseClient');
const { requireAuth, requireSuperadmin } = require('../auth');

const router = express.Router();

// Cualquiera del personal logueado puede ver el modelo (para saber que dice).
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('contract_template').select('*').eq('id', 1).maybeSingle();
  if (error) return res.status(500).json({ error: 'Error al buscar el modelo de contrato.' });
  res.json(data || {});
});

// Solo el Administrador puede agregar, borrar o editar clausulas del modelo.
router.put('/', requireSuperadmin, async (req, res) => {
  try {
    const { intro, clauses, signature_block } = req.body;
    const updates = { updated_at: new Date().toISOString() };
    if (intro !== undefined) updates.intro = intro;
    if (clauses !== undefined) updates.clauses = clauses;
    if (signature_block !== undefined) updates.signature_block = signature_block;

    const { data, error } = await supabase.from('contract_template').update(updates).eq('id', 1).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar el modelo de contrato.' });
  }
});

module.exports = router;
