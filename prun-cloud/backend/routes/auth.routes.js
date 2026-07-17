// routes/auth.routes.js
const express = require('express');
const bcrypt = require('bcryptjs');
const supabase = require('../supabaseClient');
const { generateToken } = require('../auth');

const router = express.Router();

// Login del panel de administracion
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Ingresá tu email y contraseña.' });
    }

    const { data: account, error } = await supabase
      .from('admin_accounts')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (error) throw error;
    if (!account) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });

    const valid = bcrypt.compareSync(password, account.password_hash);
    if (!valid) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });

    const token = generateToken(account);
    res.json({
      token,
      user: { id: account.id, name: account.name, email: account.email, role: account.role },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al iniciar sesión.' });
  }
});

// Registro de usuarios del sitio publico (compradores, propietarios, agentes)
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, phone, role } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nombre, email y contraseña son obligatorios.' });
    }

    const { data: existing } = await supabase
      .from('site_users').select('id').eq('email', email).maybeSingle();
    if (existing) return res.status(409).json({ error: 'Ya existe una cuenta con ese email.' });

    const allowedRoles = ['client', 'owner', 'agent'];
    const finalRole = allowedRoles.includes(role) ? role : 'client';
    const password_hash = bcrypt.hashSync(password, 10);

    const { data, error } = await supabase
      .from('site_users')
      .insert([{ name, email, password_hash, phone: phone || '', role: finalRole }])
      .select()
      .single();
    if (error) throw error;

    res.status(201).json({ id: data.id, name: data.name, email: data.email, role: data.role });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al registrar el usuario.' });
  }
});

module.exports = router;
