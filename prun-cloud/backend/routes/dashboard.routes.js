// routes/dashboard.routes.js
const express = require('express');
const supabase = require('../supabaseClient');
const { requireAuth } = require('../auth');

const router = express.Router();

router.get('/stats', requireAuth, async (req, res) => {
  try {
    const [{ count: totalProperties }, { count: forSale }, { count: forRent }, { count: sold }, { count: rented },
           { count: totalInquiries }, { count: unreadInquiries }] = await Promise.all([
      supabase.from('properties').select('*', { count: 'exact', head: true }),
      supabase.from('properties').select('*', { count: 'exact', head: true }).eq('operation', 'venta'),
      supabase.from('properties').select('*', { count: 'exact', head: true }).eq('operation', 'alquiler'),
      supabase.from('properties').select('*', { count: 'exact', head: true }).eq('status', 'vendido'),
      supabase.from('properties').select('*', { count: 'exact', head: true }).eq('status', 'alquilado'),
      supabase.from('inquiries').select('*', { count: 'exact', head: true }),
      supabase.from('inquiries').select('*', { count: 'exact', head: true }).eq('is_read', false),
    ]);

    const { data: recentInquiries } = await supabase.from('inquiries')
      .select('*').order('created_at', { ascending: false }).limit(5);
    const { data: recentProperties } = await supabase.from('properties')
      .select('*').order('created_at', { ascending: false }).limit(5);

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
