// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const supabase = require('./supabaseClient');

const authRoutes = require('./routes/auth.routes');
const propertiesRoutes = require('./routes/properties.routes');
const inquiriesRoutes = require('./routes/inquiries.routes');
const dashboardRoutes = require('./routes/dashboard.routes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// El sitio publico y el panel se sirven como archivos estaticos desde /frontend
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.use('/api/auth', authRoutes);
app.use('/api/properties', propertiesRoutes);
app.use('/api/inquiries', inquiriesRoutes);
app.use('/api/dashboard', dashboardRoutes);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'Servidor de Prun Bienes Raíces (nube) funcionando correctamente.' });
});

// Crea la cuenta de Administrador la primera vez que arranca el servidor, si no existe.
async function ensureAdminAccount() {
  const email = process.env.ADMIN_EMAIL || 'admin@prunbienes.com';
  const password = process.env.ADMIN_PASSWORD || 'admin1234';

  const { data: existing, error: selectError } = await supabase
    .from('admin_accounts').select('id').eq('email', email).maybeSingle();

  if (selectError) {
    console.error('No se pudo verificar la cuenta de administrador. ¿Corriste el supabase-schema.sql? ->', selectError.message);
    return;
  }
  if (existing) return;

  const password_hash = bcrypt.hashSync(password, 10);
  const { error: insertError } = await supabase.from('admin_accounts').insert([{
    email, password_hash, role: 'superadmin', name: 'Administrador',
  }]);
  if (insertError) console.error('No se pudo crear la cuenta de administrador ->', insertError.message);
  else console.log(`Cuenta de administrador creada: ${email} / ${password}`);
}

ensureAdminAccount().then(() => {
  app.listen(PORT, () => {
    console.log('==================================================');
    console.log(' PRUN BIENES RAICES - Servidor (nube) iniciado');
    console.log(` Puerto: ${PORT}`);
    console.log('==================================================');
  });
});
