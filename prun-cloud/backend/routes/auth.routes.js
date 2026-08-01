// routes/auth.routes.js
const express = require('express');
const bcrypt = require('bcryptjs');
const supabase = require('../supabaseClient');
const { generateToken, requireAuth, requireSuperadmin } = require('../auth');

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

// Login de usuarios del sitio publico (compradores, propietarios, agentes)
router.post('/user-login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Ingresá tu email y contraseña.' });
    }
    const { data: user, error } = await supabase
      .from('site_users').select('*').eq('email', email).maybeSingle();
    if (error) throw error;
    if (!user) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });

    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });

    const token = generateToken({ id: user.id, email: user.email, role: user.role, name: user.name });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al iniciar sesión.' });
  }
});

// Listar usuarios registrados del sitio (clientes/propietarios/agentes) - solo para el panel
router.get('/site-users', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('site_users')
    .select('id, name, email, phone, role, created_at')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Error al buscar los usuarios registrados.' });
  res.json(data);
});

// Listar respuestas del cuestionario "Agendarme" - solo para el panel
router.get('/survey-responses', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('survey_responses')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Error al buscar las respuestas del cuestionario.' });
  res.json(data);
});

// Listar el personal del panel (usuarios internos) - solo superadmin
router.get('/staff', requireSuperadmin, async (req, res) => {
  const { data, error } = await supabase
    .from('admin_accounts').select('id, name, email, role, created_at').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Error al buscar el personal.' });
  res.json(data);
});

// Crear una cuenta de personal del panel - solo superadmin
router.post('/staff', requireSuperadmin, async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const allowedStaffRoles = ['superadmin', 'secretaria', 'vendedor', 'contador'];
    if (!name || !email || !password) return res.status(400).json({ error: 'Nombre, email y contraseña son obligatorios.' });
    if (!allowedStaffRoles.includes(role)) return res.status(400).json({ error: 'Rol inválido.' });

    const { data: existing } = await supabase.from('admin_accounts').select('id').eq('email', email).maybeSingle();
    if (existing) return res.status(400).json({ error: 'Ya existe una cuenta de personal con ese email.' });

    const password_hash = bcrypt.hashSync(password, 10);
    const { data, error } = await supabase.from('admin_accounts')
      .insert([{ name, email, password_hash, role }])
      .select('id, name, email, role, created_at').single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear la cuenta de personal.' });
  }
});

// Borrar una cuenta de personal del panel - solo superadmin
router.delete('/staff/:id', requireSuperadmin, async (req, res) => {
  const { error } = await supabase.from('admin_accounts').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Error al borrar la cuenta.' });
  res.json({ ok: true });
});

module.exports = router;
