// auth.js
// Genera y valida el token de sesion (JWT) para el panel de administracion.

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'prun_secreto_default';

function generateToken(account) {
  return jwt.sign(
    { id: account.id, email: account.email, role: account.role, name: account.name },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado. Iniciá sesión.' });
  }
  try {
    req.user = jwt.verify(header.split(' ')[1], JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesión inválida o expirada. Iniciá sesión de nuevo.' });
  }
}

function requireSuperadmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Esta acción requiere el rol Administrador.' });
    }
    next();
  });
}

module.exports = { generateToken, requireAuth, requireSuperadmin };
