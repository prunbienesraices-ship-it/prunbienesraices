// routes/owners.routes.js
const express = require('express');
const bcrypt = require('bcryptjs');
const supabase = require('../supabaseClient');
const { requireAuth } = require('../auth');
const router = express.Router();

// Cuando se crea un propietario con email, le crea automáticamente una
// cuenta para que pueda entrar al sitio (usuario: su email, contraseña: su
// DNI). Si ya tenía cuenta con un rol "menor" (garante), la sube a
// propietario. Si ya era inquilino o propietario, no la toca.
async function ensureOwnerSiteAccount(owner) {
  if (!owner.email) return;
  try {
    const { data: existing } = await supabase.from('site_users').select('id, role').eq('email', owner.email).maybeSingle();
    if (existing) {
      if (existing.role === 'guarantor') {
        await supabase.from('site_users').update({ role: 'owner' }).eq('id', existing.id);
        console.log(`Cuenta de ${owner.email} actualizada de garante a propietario.`);
      }
      return;
    }
    if (!owner.dni) { console.log(`No se pudo crear la cuenta de ${owner.email}: falta el DNI para usarlo como contraseña.`); return; }
    const dniDigits = owner.dni.replace(/\D/g, '');
    if (!dniDigits) { console.log(`No se pudo crear la cuenta de ${owner.email}: el DNI cargado no tiene números.`); return; }
    const password_hash = bcrypt.hashSync(dniDigits, 10);
    await supabase.from('site_users').insert([{
      name: owner.name, email: owner.email, password_hash, phone: owner.phone || '', role: 'owner',
    }]);
    console.log(`Cuenta del sitio creada para el propietario ${owner.name} (${owner.email}).`);
  } catch (err) {
    console.error('No se pudo crear la cuenta del propietario en el sitio ->', err.message);
  }
}

router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('owners').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Error al buscar propietarios.' });
  res.json(data);
});

router.post('/', requireAuth, async (req, res) => {
  const b = req.body;
  const { data, error } = await supabase.from('owners').insert([{
    name: b.name, dni: b.dni || '', cuit: b.cuit || '', birthdate: b.birthdate || null, marital: b.marital || '',
    address: b.address || '', phone: b.phone || '', email: b.email || '',
    cbu: b.cbu || '', alias: b.alias || '', bank: b.bank || '', account: b.account || '',
    payment_method: b.payment_method || 'transferencia', iva: b.iva || '', monotributo: b.monotributo || '',
    commission_withholding: Number(b.commission_withholding) || 0, commission_type: b.commission_type || 'percentage',
    notes: b.notes || '',
  }]).select().single();
  if (error) return res.status(500).json({ error: 'Error al crear el propietario.' });
  await ensureOwnerSiteAccount(data);
  res.status(201).json(data);
});

router.put('/:id', requireAuth, async (req, res) => {
  const b = req.body;
  const updates = {};
  ['name','dni','cuit','birthdate','marital','address','phone','email','cbu','alias','bank','account',
   'payment_method','iva','monotributo','commission_type','notes'].forEach(f => {
    if (b[f] !== undefined) updates[f] = b[f];
  });
  if (b.commission_withholding !== undefined) updates.commission_withholding = Number(b.commission_withholding) || 0;
  const { data, error } = await supabase.from('owners').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: 'Error al editar el propietario.' });
  await ensureOwnerSiteAccount(data);
  res.json(data);
});

router.delete('/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('owners').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Error al borrar el propietario.' });
  res.json({ ok: true });
});

module.exports = router;
