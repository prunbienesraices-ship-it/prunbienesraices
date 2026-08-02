// routes/my-expensas.routes.js
const express = require('express');
const supabase = require('../supabaseClient');
const { requireAuth } = require('../auth');

const router = express.Router();

// El propietario o inquilino logueado ve las expensas del/los edificio/s
// donde tiene una propiedad (propia, o la que alquila), sin ver nada de
// otros edificios ni de otros clientes.
router.get('/', requireAuth, async (req, res) => {
  try {
    const email = req.user.email;
    const role = req.user.role;
    let developmentIds = [];

    if (role === 'owner') {
      const { data: owner } = await supabase.from('owners').select('id').eq('email', email).maybeSingle();
      if (owner) {
        const { data: props } = await supabase.from('properties').select('development_id').eq('owner_id', owner.id);
        developmentIds = [...new Set((props || []).map(p => p.development_id).filter(Boolean))];
      }
    } else if (role === 'tenant') {
      const { data: tenant } = await supabase.from('tenants').select('property_id').eq('email', email).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (tenant && tenant.property_id) {
        const { data: prop } = await supabase.from('properties').select('development_id').eq('id', tenant.property_id).maybeSingle();
        if (prop && prop.development_id) developmentIds = [prop.development_id];
      }
    }

    if (!developmentIds.length) {
      return res.json({ hasBuilding: false, expensas: [] });
    }

    const { data: expensas, error } = await supabase
      .from('expensas').select('*, developments(name)').in('development_id', developmentIds).order('period', { ascending: false });
    if (error) throw error;

    res.json({ hasBuilding: true, expensas: expensas || [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al buscar las expensas de tu edificio.' });
  }
});

module.exports = router;
