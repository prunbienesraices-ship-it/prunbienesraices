// supabaseClient.js
// Conexion al proyecto de Supabase. Usa la "service_role key", que tiene
// permisos totales - por eso esta clave SOLO vive en el servidor (.env),
// nunca se manda al navegador.

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY en las variables de entorno.');
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = supabase;
