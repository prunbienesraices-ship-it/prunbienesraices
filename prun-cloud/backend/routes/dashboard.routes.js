// routes/dashboard.routes.js
const express = require('express');
const supabase = require('../supabaseClient');
const { requireAuth } = require('../auth');

const router = express.Router();

router.get('/stats', requireAuth, async (req, res) => {
  try {
    const branchId = req.query.branch_id ? Number(req.query.branch_id) : null;

    // Si pidieron una sucursal puntual, primero buscamos los ids de sus
    // propiedades, para poder filtrar todo lo demás (consultas, etc.) por ellas.
    let propertyIdsInBranch = null;
    if (branchId) {
      const { data: branchProps } = await supabase.from('properties').select('id').eq('branch_id', branchId);
      propertyIdsInBranch = (branchProps || []).map(p => p.id);
    }

    const propBase = () => {
      let q = supabase.from('properties').select('*', { count: 'exact', head: true });
      if (branchId) q = q.eq('branch_id', branchId);
      return q;
    };
    const inqBase = () => {
      let q = supabase.from('inquiries').select('*', { count: 'exact', head: true });
      if (branchId) q = q.in('property_id', propertyIdsInBranch.length ? propertyIdsInBranch : [0]);
      return q;
    };

    const [{ count: totalProperties }, { count: forSale }, { count: forRent }, { count: sold }, { count: rented },
           { count: totalInquiries }, { count: unreadInquiries }] = await Promise.all([
      propBase(),
      propBase().eq('operation', 'venta'),
      propBase().eq('operation', 'alquiler'),
      propBase().eq('status', 'vendido'),
      propBase().eq('status', 'alquilado'),
      inqBase(),
      inqBase().eq('is_read', false),
    ]);

    let recentInquiriesQuery = supabase.from('inquiries').select('*').order('created_at', { ascending: false }).limit(5);
    let recentPropertiesQuery = supabase.from('properties').select('*').order('created_at', { ascending: false }).limit(5);
    if (branchId) {
      recentInquiriesQuery = recentInquiriesQuery.in('property_id', propertyIdsInBranch.length ? propertyIdsInBranch : [0]);
      recentPropertiesQuery = recentPropertiesQuery.eq('branch_id', branchId);
    }
    const { data: recentInquiries } = await recentInquiriesQuery;
    const { data: recentProperties } = await recentPropertiesQuery;

    res.json({
      totalProperties, forSale, forRent, sold, rented,
      totalInquiries, unreadInquiries, recentInquiries, recentProperties,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al calcular las estadísticas.' });
  }
});

module.exports = router;
