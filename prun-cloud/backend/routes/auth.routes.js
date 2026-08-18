// routes/auth.routes.js
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const supabase = require('../supabaseClient');
const { generateToken, requireAuth, requireSuperadmin } = require('../auth');
const { sendMail } = require('../mailer');

const router = express.Router();

// Login del panel de administracion
// Limita los intentos de login fallidos por email, para evitar que alguien
// pruebe contraseñas al voleo. No usa ninguna libreria extra: guarda los
// intentos en memoria, y se resetean solos si el server se reinicia.
const loginAttempts = new Map(); // email -> { count, lockedUntil }
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Ingresá tu email y contraseña.' });
    }

    const attempt = loginAttempts.get(email);
    if (attempt && attempt.lockedUntil && attempt.lockedUntil > Date.now()) {
      const minutesLeft = Math.ceil((attempt.lockedUntil - Date.now()) / 60000);
      return res.status(429).json({ error: `Demasiados intentos fallidos. Probá de nuevo en ${minutesLeft} minuto(s).` });
    }

    const { data: account, error } = await supabase
      .from('admin_accounts')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (error) throw error;
    const valid = account && bcrypt.compareSync(password, account.password_hash);

    if (!account || !valid) {
      const current = loginAttempts.get(email) || { count: 0 };
      current.count += 1;
      if (current.count >= MAX_ATTEMPTS) {
        current.lockedUntil = Date.now() + LOCK_MINUTES * 60000;
        current.count = 0;
      }
      loginAttempts.set(email, current);
      return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
    }

    loginAttempts.delete(email);
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
    const attempt = loginAttempts.get('site:' + email);
    if (attempt && attempt.lockedUntil && attempt.lockedUntil > Date.now()) {
      const minutesLeft = Math.ceil((attempt.lockedUntil - Date.now()) / 60000);
      return res.status(429).json({ error: `Demasiados intentos fallidos. Probá de nuevo en ${minutesLeft} minuto(s).` });
    }
    const { data: user, error } = await supabase
      .from('site_users').select('*').eq('email', email).maybeSingle();
    if (error) throw error;
    const valid = user && bcrypt.compareSync(password, user.password_hash);

    if (!user || !valid) {
      const current = loginAttempts.get('site:' + email) || { count: 0 };
      current.count += 1;
      if (current.count >= MAX_ATTEMPTS) {
        current.lockedUntil = Date.now() + LOCK_MINUTES * 60000;
        current.count = 0;
      }
      loginAttempts.set('site:' + email, current);
      return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
    }

    loginAttempts.delete('site:' + email);
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

// Editar un cliente registrado en el sitio - solo el administrador
router.put('/site-users/:id', requireSuperadmin, async (req, res) => {
  try {
    const { name, email, phone, role } = req.body;
    const allowedRoles = ['client', 'owner', 'tenant', 'agent'];
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email;
    if (phone !== undefined) updates.phone = phone;
    if (role !== undefined) {
      if (!allowedRoles.includes(role)) return res.status(400).json({ error: 'Rol inválido.' });
      updates.role = role;
    }
    const { data, error } = await supabase.from('site_users').update(updates).eq('id', req.params.id)
      .select('id, name, email, phone, role, created_at').single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar el cliente.' });
  }
});

// Borrar un cliente registrado en el sitio - solo el administrador
router.delete('/site-users/:id', requireSuperadmin, async (req, res) => {
  const { error } = await supabase.from('site_users').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Error al borrar el cliente.' });
  res.json({ ok: true });
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
    .from('admin_accounts').select('id, name, email, role, branch_id, created_at').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Error al buscar el personal.' });
  res.json(data);
});

// Crear una cuenta de personal del panel - solo superadmin
router.post('/staff', requireSuperadmin, async (req, res) => {
  try {
    const { name, email, password, role, branch_id } = req.body;
    const allowedStaffRoles = ['superadmin', 'secretaria', 'vendedor', 'contador'];
    if (!name || !email || !password) return res.status(400).json({ error: 'Nombre, email y contraseña son obligatorios.' });
    if (!allowedStaffRoles.includes(role)) return res.status(400).json({ error: 'Rol inválido.' });

    const { data: existing } = await supabase.from('admin_accounts').select('id').eq('email', email).maybeSingle();
    if (existing) return res.status(400).json({ error: 'Ya existe una cuenta de personal con ese email.' });

    const password_hash = bcrypt.hashSync(password, 10);
    const { data, error } = await supabase.from('admin_accounts')
      .insert([{ name, email, password_hash, role, branch_id: branch_id ? Number(branch_id) : null }])
      .select('id, name, email, role, branch_id, created_at').single();
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

// Restablecer la contraseña de una cuenta de personal - solo superadmin.
// (Para clientes/propietarios/inquilinos del sitio, la recuperación por
// email requiere configurar un servicio de correo - lo dejamos para más
// adelante si hace falta).
router.put('/staff/:id/password', requireSuperadmin, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
    const password_hash = bcrypt.hashSync(password, 10);
    const { error } = await supabase.from('admin_accounts').update({ password_hash }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al restablecer la contraseña.' });
  }
});

// Cambiar la contraseña (logueado) — para inquilinos, propietarios,
// garantes o cualquier otra cuenta del sitio. Pide la contraseña actual
// para confirmar que es la persona dueña de la cuenta.
router.put('/site-user/password', requireAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!new_password || new_password.length < 4) return res.status(400).json({ error: 'La contraseña nueva tiene que tener al menos 4 caracteres.' });
    const { data: user } = await supabase.from('site_users').select('*').eq('email', req.user.email).maybeSingle();
    if (!user) return res.status(404).json({ error: 'No encontramos tu cuenta.' });
    if (!bcrypt.compareSync(current_password || '', user.password_hash)) {
      return res.status(401).json({ error: 'La contraseña actual no es correcta.' });
    }
    const password_hash = bcrypt.hashSync(new_password, 10);
    await supabase.from('site_users').update({ password_hash }).eq('id', user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al cambiar la contraseña.' });
  }
});

// "Olvidé mi contraseña" — genera un link de un solo uso, válido 1 hora, y
// lo manda por mail. No confirma si el mail existe o no en la respuesta,
// para no filtrar esa información a quien lo esté probando.
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Ingresá tu email.' });
    const { data: user } = await supabase.from('site_users').select('id, name, email').eq('email', email).maybeSingle();
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hora
      await supabase.from('site_users').update({ reset_token: token, reset_token_expires: expires }).eq('id', user.id);
      const siteUrl = process.env.SITE_URL || 'https://prunbienesraices.onrender.com';
      const resetLink = `${siteUrl}/index.html?reset=${token}`;
      try {
        await sendMail({
          to: user.email, subject: 'Recuperar contraseña — Prun Bienes Raíces',
          html: `<div style="font-family:Arial,sans-serif;max-width:480px">
            <p>Hola ${user.name || ''},</p>
            <p>Nos pediste recuperar tu contraseña. Tocá este link para elegir una nueva (válido por 1 hora):</p>
            <p><a href="${resetLink}" style="background:#111;color:#fff;padding:10px 18px;text-decoration:none;display:inline-block">Elegir nueva contraseña</a></p>
            <p style="font-size:12px;color:#777">Si no pediste esto, ignorá este mail — tu contraseña actual sigue funcionando igual.</p>
          </div>`,
        });
      } catch (mailErr) { console.error('No se pudo enviar el mail de recuperación ->', mailErr.message); }
    }
    // Siempre responde lo mismo, exista o no la cuenta.
    res.json({ ok: true, message: 'Si ese email está registrado, te llegó un mail con el link para recuperar tu contraseña.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al procesar el pedido.' });
  }
});

// Confirma el link de recuperación y define la contraseña nueva.
router.post('/reset-password', async (req, res) => {
  try {
    const { token, new_password } = req.body;
    if (!token || !new_password || new_password.length < 4) return res.status(400).json({ error: 'Faltan datos, o la contraseña es muy corta.' });
    const { data: user } = await supabase.from('site_users').select('*').eq('reset_token', token).maybeSingle();
    if (!user || !user.reset_token_expires || new Date(user.reset_token_expires) < new Date()) {
      return res.status(400).json({ error: 'Ese link ya venció o no es válido. Pedí uno nuevo.' });
    }
    const password_hash = bcrypt.hashSync(new_password, 10);
    await supabase.from('site_users').update({ password_hash, reset_token: null, reset_token_expires: null }).eq('id', user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al restablecer la contraseña.' });
  }
});

module.exports = router;
