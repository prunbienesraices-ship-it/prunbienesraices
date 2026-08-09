// routes/tenants.routes.js
const express = require('express');
const bcrypt = require('bcryptjs');
const supabase = require('../supabaseClient');
const { requireAuth } = require('../auth');

const router = express.Router();

// Cuando se crea un inquilino con email, le crea automáticamente una cuenta
// para que pueda entrar al sitio (usuario: su email, contraseña: su DNI).
// Si ya existe una cuenta con ese email (por ejemplo, si ya se había
// registrado solo, o ya es propietario tambien), no la toca ni la duplica.
async function ensureTenantSiteAccount(tenant) {
  if (!tenant.email) return;
  try {
    const { data: existing } = await supabase.from('site_users').select('id').eq('email', tenant.email).maybeSingle();
    if (existing) return;
    if (!tenant.dni) { console.log(`No se pudo crear la cuenta de ${tenant.email}: falta el DNI para usarlo como contraseña.`); return; }
    const dniDigits = tenant.dni.replace(/\D/g, ''); // solo numeros, sin puntos ni espacios
    if (!dniDigits) { console.log(`No se pudo crear la cuenta de ${tenant.email}: el DNI cargado no tiene números.`); return; }
    const password_hash = bcrypt.hashSync(dniDigits, 10);
    await supabase.from('site_users').insert([{
      name: tenant.name, email: tenant.email, password_hash, phone: tenant.phone || '', role: 'tenant',
    }]);
    console.log(`Cuenta del sitio creada para el inquilino ${tenant.name} (${tenant.email}).`);
  } catch (err) {
    console.error('No se pudo crear la cuenta del inquilino en el sitio ->', err.message);
  }
}

// Todas las rutas de inquilinos requieren estar logueado en el panel.

// Listar todos los inquilinos/contratos
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('tenants').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Error al buscar los inquilinos.' });
  res.json(data);
});

// Ver un contrato puntual
router.get('/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('tenants').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: 'Error al buscar el contrato.' });
  if (!data) return res.status(404).json({ error: 'Contrato no encontrado.' });
  res.json(data);
});

// Crear un contrato nuevo
router.post('/', requireAuth, async (req, res) => {
  try {
    const b = req.body;
    if (!b.property_id || !b.name || !b.start_date || !b.end_date) {
      return res.status(400).json({ error: 'Propiedad, inquilino, fecha de inicio y fin son obligatorios.' });
    }
    const { data, error } = await supabase.from('tenants').insert([{
      property_id: b.property_id,
      name: b.name, dni: b.dni || '', cuil: b.cuil || '', phone: b.phone || '', email: b.email || '',
      company: b.company || '', employment_status: b.employment_status || '',
      occupants: b.occupants || null, pets: b.pets || '', family: b.family || '',
      references: b.references || '', insurance: b.insurance || '',
      owner_name: b.owner_name || '', owner_phone: b.owner_phone || '', owner_email: b.owner_email || '',
      owner_dni: b.owner_dni || '', owner_address: b.owner_address || '',
      start_date: b.start_date, end_date: b.end_date, currency: b.currency || 'ARS',
      payday: b.payday || null, deposit: Number(b.deposit) || 0,
      contract_total_amount: Number(b.contract_total_amount) || 0,
      late_coefficient: Number(b.late_coefficient) || 0,
      update_freq: b.update_freq || 'trimestral', update_index: b.update_index || 'ICL',
      rent_type: b.rent_type || 'fijo',
      guarantee: b.guarantee || '', status_override: b.status_override || '',
      guarantors: b.guarantors || [], rent_history: b.rent_history || [], payments: b.payments || [],
      notes: b.notes || '',
    }]).select().single();
    if (error) throw error;
    await ensureTenantSiteAccount(data);
    res.status(201).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear el contrato.' });
  }
});

// Editar un contrato (incluye guardar nuevos pagos o aumentos, ya que se manda la lista completa actualizada)
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const b = req.body;
    const updates = {};
    const fields = [
      'property_id','name','dni','cuil','phone','email','company','employment_status','occupants','pets',
      'family','references','insurance','owner_name','owner_phone','owner_email','owner_dni','owner_address','start_date','end_date',
      'currency','payday','deposit','contract_total_amount','late_coefficient','update_freq','update_index','rent_type','guarantee',
      'status_override','guarantors','rent_history','payments','notes',
    ];
    fields.forEach(f => { if (b[f] !== undefined) updates[f] = b[f]; });
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase.from('tenants').update(updates).eq('id', req.params.id).select().single();
    if (error) throw error;
    await ensureTenantSiteAccount(data);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar el contrato.' });
  }
});

// Borrar un contrato
router.delete('/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('tenants').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Error al borrar el contrato.' });
  res.json({ ok: true });
});

module.exports = router;
