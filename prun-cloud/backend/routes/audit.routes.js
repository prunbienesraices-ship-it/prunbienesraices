// routes/audit.routes.js
const express = require('express');
const supabase = require('../supabaseClient');
const { requireAuth } = require('../auth');
const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) return res.status(500).json({ error: 'Error al buscar la auditoría.' });
  res.json(data);
});
router.post('/', requireAuth, async (req, res) => {
  const b = req.body;
  const { data, error } = await supabase.from('audit_log').insert([{
    user_name: req.user.name || 'Admin', action: b.action, old_value: b.old_value || '', new_value: b.new_value || '',
  }]).select().single();
  if (error) return res.status(500).json({ error: 'Error al registrar la auditoría.' });
  res.status(201).json(data);
});
module.exports = router;
