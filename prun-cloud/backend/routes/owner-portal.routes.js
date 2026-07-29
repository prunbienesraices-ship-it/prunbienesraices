// routes/owner-portal.routes.js
const express = require('express');
const supabase = require('../supabaseClient');
const { requireAuth } = require('../auth');

const router = express.Router();

// El propietario logueado (con su cuenta de cliente/sitio) ve sus propiedades
// y los reclamos/reparaciones vinculados a ellas.
router.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const email = req.user.email;

    // Buscamos su ficha de propietario por email (la misma que usa el panel interno).
    const { data: owner, error: ownerErr } = await supabase
      .from('owners').select('*').eq('email', email).maybeSingle();
    if (ownerErr) throw ownerErr;

    if (!owner) {
      return res.json({ isOwner: false, properties: [], repairs: [] });
    }

    const { data: properties, error: propsErr } = await supabase
      .from('properties').select('*').eq('owner_id', owner.id).order('created_at', { ascending: false });
    if (propsErr) throw propsErr;

    const propertyIds = (properties || []).map(p => p.id);
    let repairs = [];
    if (propertyIds.length) {
      const { data: repairsData, error: repairsErr } = await supabase
        .from('repairs').select('*').in('property_id', propertyIds).order('created_at', { ascending: false });
      if (repairsErr) throw repairsErr;
      repairs = repairsData || [];
    }

    res.json({ isOwner: true, owner, properties: properties || [], repairs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al buscar tu información como propietario.' });
  }
});

module.exports = router;
