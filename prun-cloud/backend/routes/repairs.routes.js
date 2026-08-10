// routes/repairs.routes.js
const express = require('express');
const multer = require('multer');
const supabase = require('../supabaseClient');
const { requireAuth } = require('../auth');
const { sendMail } = require('../mailer');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('repairs').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Error al buscar reparaciones.' });
  res.json(data);
});

router.post('/', requireAuth, async (req, res) => {
  const b = req.body;
  const { data, error } = await supabase.from('repairs').insert([{
    property_id: b.property_id, title: b.title, type: b.type || 'incidencia', status: b.status || 'reportado',
    cost: b.cost ? Number(b.cost) : 0, payer: b.payer || 'propietario', provider: b.provider || '',
    warranty: b.warranty || '', notes: b.notes || '', date_reported: new Date().toISOString().slice(0, 10),
    priority: b.priority || 'media', estimated_date: b.estimated_date || null,
    images: [], budgets: [], response: '', reporter_email: '',
  }]).select().single();
  if (error) return res.status(500).json({ error: 'Error al crear la reparación.' });
  res.status(201).json(data);
});

// Sube el archivo de un presupuesto (PDF o foto) al mismo bucket que se usa
// para el resto de las imágenes del sistema.
async function uploadBudgetFile(file) {
  if (!file) return null;
  const fileName = `presupuesto-${Date.now()}-${Math.round(Math.random() * 1e9)}.${file.originalname.split('.').pop()}`;
  const { error } = await supabase.storage.from('property-photos').upload(fileName, file.buffer, { contentType: file.mimetype });
  if (error) { console.error('Error subiendo presupuesto:', error); return null; }
  const { data } = supabase.storage.from('property-photos').getPublicUrl(fileName);
  return data.publicUrl;
}

router.put('/:id', requireAuth, upload.single('budget_file'), async (req, res) => {
  try {
    const b = req.body;
    const { data: current } = await supabase.from('repairs').select('*').eq('id', req.params.id).maybeSingle();
    if (!current) return res.status(404).json({ error: 'No encontramos esa reparación.' });

    const updates = {};
    ['title', 'type', 'status', 'payer', 'provider', 'warranty', 'notes', 'response', 'priority'].forEach(f => {
      if (b[f] !== undefined) updates[f] = b[f];
    });
    if (b.cost !== undefined) updates.cost = Number(b.cost) || 0;
    if (b.estimated_date !== undefined) updates.estimated_date = b.estimated_date || null;

    // Si mandaron un presupuesto nuevo (monto y/o archivo), se agrega a la
    // lista de presupuestos existentes, sin borrar los anteriores.
    if (b.budget_amount || req.file) {
      const fileUrl = await uploadBudgetFile(req.file);
      const newBudget = {
        amount: b.budget_amount ? Number(b.budget_amount) : null,
        provider: b.budget_provider || '',
        file_url: fileUrl,
        date: new Date().toISOString().slice(0, 10),
      };
      updates.budgets = [...(current.budgets || []), newBudget];
    }

    const { data, error } = await supabase.from('repairs').update(updates).eq('id', req.params.id).select().single();
    if (error) throw error;

    // Si se cargó o cambió la respuesta, y sabemos el mail de quien
    // reclamó, le avisamos por mail que el equipo respondió.
    if (b.response !== undefined && b.response !== current.response && current.reporter_email) {
      try {
        await sendMail({
          to: current.reporter_email,
          subject: `Respuesta a tu reclamo — ${data.title}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:520px">
            <p>Hola,</p>
            <p>Te llegó una respuesta sobre tu reclamo <strong>"${data.title}"</strong>:</p>
            <p style="background:#f5f5f5;padding:14px;border-radius:6px">${b.response}</p>
            <p>Estado actual: <strong>${data.status}</strong></p>
            ${data.estimated_date ? `<p>Fecha estimada: <strong>${data.estimated_date}</strong></p>` : ''}
          </div>`,
        });
      } catch (mailErr) { console.error('No se pudo avisar por mail al reclamante ->', mailErr.message); }
    }

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al editar la reparación.' });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('repairs').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Error al borrar la reparación.' });
  res.json({ ok: true });
});

module.exports = router;
