// routes/tenant-portal.routes.js
const express = require('express');
const supabase = require('../supabaseClient');
const { requireAuth } = require('../auth');

const router = express.Router();

// El inquilino logueado solo puede generar un reporte de reparacion para
// la propiedad que alquila. No puede ver ni modificar nada mas del sistema.
router.post('/report', requireAuth, async (req, res) => {
  try {
    const email = req.user.email;
    const { title, notes } = req.body;
    if (!title) return res.status(400).json({ error: 'Contanos qué hay que reparar.' });

    const { data: tenant, error: tenantErr } = await supabase
      .from('tenants').select('property_id').eq('email', email).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (tenantErr) throw tenantErr;
    if (!tenant || !tenant.property_id) {
      return res.status(404).json({ error: 'No encontramos un contrato de alquiler asociado a tu cuenta. Si ya sos inquilino nuestro, escribinos por Contacto para vincular tu cuenta.' });
    }

    const { data, error } = await supabase.from('repairs').insert([{
      property_id: tenant.property_id, type: 'incidencia', status: 'reportado',
      title, notes: notes || '', date_reported: new Date().toISOString().slice(0, 10),
      payer: 'a definir',
    }]).select().single();
    if (error) throw error;
    res.status(201).json({ ok: true, repair: data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al enviar tu reporte. Probá de nuevo en un momento.' });
  }
});

module.exports = router;
