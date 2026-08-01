// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('./supabaseClient');

const authRoutes = require('./routes/auth.routes');
const propertiesRoutes = require('./routes/properties.routes');
const inquiriesRoutes = require('./routes/inquiries.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const tenantsRoutes = require('./routes/tenants.routes');
const developmentsRoutes = require('./routes/developments.routes');
const ownersRoutes = require('./routes/owners.routes');
const repairsRoutes = require('./routes/repairs.routes');
const providersRoutes = require('./routes/providers.routes');
const dealsRoutes = require('./routes/deals.routes');
const collectionsRoutes = require('./routes/collections.routes');
const settlementsRoutes = require('./routes/settlements.routes');
const agendaRoutes = require('./routes/agenda.routes');
const auditRoutes = require('./routes/audit.routes');
const surveyRoutes = require('./routes/survey.routes');
const ownerPortalRoutes = require('./routes/owner-portal.routes');
const siteConfigRoutes = require('./routes/site-config.routes');
const tenantPortalRoutes = require('./routes/tenant-portal.routes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// El sitio publico y el panel se sirven como archivos estaticos desde /frontend
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Restriccion de permisos por rol, valida para todas las rutas /api/*.
// - vendedor: puede agregar y editar, pero nunca borrar (DELETE).
// - contador: solo puede leer (GET), no puede crear, editar ni borrar nada.
// El resto de las restricciones puntuales (como Apariencia del sitio, que
// requiere superadmin) se manejan aparte, en cada ruta.
const JWT_SECRET = process.env.JWT_SECRET || 'prun_secreto_default';
app.use('/api', (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return next();
  try {
    const payload = jwt.verify(header.split(' ')[1], JWT_SECRET);
    if (payload.role === 'vendedor' && req.method === 'DELETE') {
      return res.status(403).json({ error: 'Tu perfil (Vendedor) no tiene permiso para borrar registros.' });
    }
    if (payload.role === 'vendedor' && (req.path.startsWith('/collections') || req.path.startsWith('/settlements'))) {
      return res.status(403).json({ error: 'Tu perfil (Vendedor) no tiene acceso a Cobranzas ni Liquidaciones.' });
    }
    if (payload.role === 'contador' && req.method !== 'GET') {
      return res.status(403).json({ error: 'Tu perfil (Contador) solo tiene permiso para consultar información, no para modificarla.' });
    }
  } catch (e) { /* si el token no es valido, cada ruta lo maneja por su cuenta */ }
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/properties', propertiesRoutes);
app.use('/api/inquiries', inquiriesRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/tenants', tenantsRoutes);
app.use('/api/developments', developmentsRoutes);
app.use('/api/owners', ownersRoutes);
app.use('/api/repairs', repairsRoutes);
app.use('/api/providers', providersRoutes);
app.use('/api/deals', dealsRoutes);
app.use('/api/collections', collectionsRoutes);
app.use('/api/settlements', settlementsRoutes);
app.use('/api/agenda', agendaRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/survey', surveyRoutes);
app.use('/api/owner-portal', ownerPortalRoutes);
app.use('/api/site-config', siteConfigRoutes);
app.use('/api/tenant-portal', tenantPortalRoutes);

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
