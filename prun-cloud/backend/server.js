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
const guarantorPortalRoutes = require('./routes/guarantor-portal.routes');
const siteConfigRoutes = require('./routes/site-config.routes');
const tenantPortalRoutes = require('./routes/tenant-portal.routes');
const expensasRoutes = require('./routes/expensas.routes');
const myExpensasRoutes = require('./routes/my-expensas.routes');
const paymentsRoutes = require('./routes/payments.routes');
const branchesRoutes = require('./routes/branches.routes');
const contractRoutes = require('./routes/contract.routes');
const paymentDetailRoutes = require('./routes/payment-detail.routes');
const paymentDetailTemplateRoutes = require('./routes/payment-detail-template.routes');
const guarantorsRoutes = require('./routes/guarantors.routes');
const reputationRoutes = require('./routes/reputation.routes');
const obrasRoutes = require('./routes/obras.routes');
const contractTemplateRoutes = require('./routes/contract-template.routes');
const { DEFAULT_CONTRACT_TEMPLATE } = require('./default-contract-template');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// El sitio publico y el panel se sirven como archivos estaticos desde /frontend.
// Los .html nunca se guardan en cache del navegador, para que cada actualizacion
// se vea al instante sin tener que forzar Ctrl+F5 ni agregar ?v=... a la URL.
app.use(express.static(path.join(__dirname, '..', 'frontend'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  },
}));

// Link "siempre fresco" al panel: cada vez que se entra acá, redirige al
// admin.html agregando un numero distinto al final (la hora exacta), para
// que nunca traiga una copia vieja guardada, sin tener que acordarse de
// cambiar nada a mano. Usar https://.../panel en vez de admin.html directo.
app.get('/panel', (req, res) => {
  res.redirect(`/admin-nuevo.html?v=${Date.now()}`);
});

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
app.use('/api/guarantor-portal', guarantorPortalRoutes);
app.use('/api/site-config', siteConfigRoutes);
app.use('/api/tenant-portal', tenantPortalRoutes);
app.use('/api/expensas', expensasRoutes);
app.use('/api/my-expensas', myExpensasRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/branches', branchesRoutes);
app.use('/api/contract', contractRoutes);
app.use('/api/payment-detail', paymentDetailRoutes);
app.use('/api/payment-detail-template', paymentDetailTemplateRoutes);
app.use('/api/guarantors', guarantorsRoutes);
app.use('/api/reputation', reputationRoutes);
app.use('/api/obras', obrasRoutes);
app.use('/api/contract-template', contractTemplateRoutes);

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

// Carga el modelo de contrato completo la primera vez que arranca el
// servidor (si todavia esta vacio). Despues de eso, el Administrador lo
// edita desde el panel y esos cambios prevalecen siempre.
async function ensureContractTemplate() {
  const { data: existing, error: selectError } = await supabase
    .from('contract_template').select('clauses').eq('id', 1).maybeSingle();

  if (selectError) {
    console.error('No se pudo verificar el modelo de contrato. ¿Corriste el schema de contract_template? ->', selectError.message);
    return;
  }
  if (existing && existing.clauses && existing.clauses.length) return;

  const { error: updateError } = await supabase.from('contract_template').update({
    intro: DEFAULT_CONTRACT_TEMPLATE.intro,
    clauses: DEFAULT_CONTRACT_TEMPLATE.clauses,
    signature_block: DEFAULT_CONTRACT_TEMPLATE.signature_block,
  }).eq('id', 1);
  if (updateError) console.error('No se pudo cargar el modelo de contrato por defecto ->', updateError.message);
  else console.log('Modelo de contrato por defecto cargado.');
}

// Carga las notas por defecto del detalle de pago la primera vez que arranca
// el servidor (si todavia esta vacio). Despues de eso, el Administrador las
// edita desde el panel y esos cambios prevalecen siempre.
async function ensurePaymentDetailTemplate() {
  const { data: existing, error: selectError } = await supabase
    .from('payment_detail_template').select('footer_notes, header_lines').eq('id', 1).maybeSingle();

  if (selectError) {
    console.error('No se pudo verificar el modelo de detalle de pago. ¿Corriste el schema de payment_detail_template? ->', selectError.message);
    return;
  }
  const updates = {};
  if (!existing || !existing.footer_notes || !existing.footer_notes.length) {
    updates.footer_notes = [
      'LOS PAGOS NO PUEDEN SER PARCIALES, SOLO SE ACEPTAN PAGOS TOTAL DE LA DEUDA.',
      'Los comprobantes de servicios y depósito deben ser enviados al mail indicado arriba, asunto: (nombre y apellido, y datos de la propiedad).',
    ];
  }
  if (!existing || !existing.header_lines || !existing.header_lines.length) {
    updates.header_lines = ['{{ADDRESS}}', 'Tel. {{PHONE}}', 'mail: {{EMAIL}}'];
  }
  if (!Object.keys(updates).length) return;

  const { error: updateError } = await supabase.from('payment_detail_template').update(updates).eq('id', 1);
  if (updateError) console.error('No se pudo cargar el modelo de detalle de pago por defecto ->', updateError.message);
  else console.log('Modelo de detalle de pago por defecto cargado.');
}

ensureAdminAccount().then(() => ensureContractTemplate()).then(() => ensurePaymentDetailTemplate()).then(() => {
  app.listen(PORT, () => {
    console.log('==================================================');
    console.log(' PRUN BIENES RAICES - Servidor (nube) iniciado');
    console.log(` Puerto: ${PORT}`);
    console.log('==================================================');
  });
});
