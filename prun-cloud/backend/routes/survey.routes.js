// routes/survey.routes.js
const express = require('express');
const bcrypt = require('bcryptjs');
const supabase = require('../supabaseClient');

const router = express.Router();

// Publico: un visitante completa el cuestionario para agendarse.
// Si manda contrasena, tambien le crea la cuenta. Ademas, genera
// automaticamente un lead en el Pipeline de Ventas para que el
// personal lo vea y haga seguimiento.
router.post('/', async (req, res) => {
  try {
    const { name, email, phone, password, interest, budget, timeline, property_id, preferred_date, notes } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: 'Nombre y email son obligatorios.' });
    }

    let userId = null;
    if (password) {
      const { data: existing } = await supabase.from('site_users').select('id').eq('email', email).maybeSingle();
      if (existing) {
        userId = existing.id;
      } else {
        const password_hash = bcrypt.hashSync(password, 10);
        const { data: newUser, error: userErr } = await supabase.from('site_users')
          .insert([{ name, email, password_hash, phone: phone || '', role: 'client' }])
          .select().single();
        if (userErr) throw userErr;
        userId = newUser.id;
      }
    }

    const { data: survey, error: surveyErr } = await supabase.from('survey_responses').insert([{
      user_id: userId, name, email, phone: phone || '', interest: interest || '', budget: budget || '',
      timeline: timeline || '', property_id: property_id || null, preferred_date: preferred_date || null,
      notes: notes || '',
    }]).select().single();
    if (surveyErr) throw surveyErr;

    // Crea el lead automaticamente en el Pipeline de Ventas.
    await supabase.from('deals').insert([{
      property_id: property_id || null, name, phone: phone || '', email, amount: 0, agent: '', stage: 'lead',
      notes: `Se agendó desde el sitio. Busca: ${interest || '-'}. Presupuesto: ${budget || '-'}. Plazo: ${timeline || '-'}.${preferred_date ? ' Fecha preferida: '+preferred_date+'.' : ''}`,
      history: [{ stage: 'lead', date: new Date().toISOString(), user: 'Sitio web' }],
    }]);

    res.status(201).json({ ok: true, accountCreated: !!password, survey });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar tu solicitud. Probá de nuevo en un momento.' });
  }
});

module.exports = router;
