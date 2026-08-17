// routes/classifieds.routes.js
const express = require('express');
const multer = require('multer');
const supabase = require('../supabaseClient');
const { requireAuth } = require('../auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Roles del PANEL (personal) — a diferencia de los roles de sitio
// (tenant/owner/guarantor/client), estos pueden moderar cualquier publicación.
const STAFF_ROLES = ['superadmin', 'secretaria', 'vendedor', 'contador'];

async function uploadClassifiedPhotos(files) {
  if (!files || !files.length) return [];
  const urls = [];
  for (const file of files) {
    const fileName = `clasificado-${Date.now()}-${Math.round(Math.random() * 1e9)}.${file.originalname.split('.').pop()}`;
    const { error } = await supabase.storage.from('property-photos').upload(fileName, file.buffer, { contentType: file.mimetype });
    if (error) { console.error('Error subiendo foto de clasificado:', error); continue; }
    const { data } = supabase.storage.from('property-photos').getPublicUrl(fileName);
    urls.push(data.publicUrl);
  }
  return urls;
}

// Lista las publicaciones activas. Cualquier persona logueada en el sitio
// (o en el panel) las puede ver. Se puede filtrar por ciudad.
router.get('/', requireAuth, async (req, res) => {
  try {
    let query = supabase.from('classifieds').select('*').order('created_at', { ascending: false });
    if (req.query.city) query = query.ilike('city', `%${req.query.city}%`);
    if (req.query.status) query = query.eq('status', req.query.status);
    else query = query.neq('status', 'eliminado');
    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al buscar los clasificados.' });
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('classifieds').select('*').eq('id', req.params.id).maybeSingle();
  if (error || !data) return res.status(404).json({ error: 'No encontramos esa publicación.' });
  res.json(data);
});

// Crear una publicación nueva. Cualquier persona con perfil en el sitio
// (inquilino, propietario, garante, cliente) puede publicar.
router.post('/', requireAuth, upload.array('photos', 5), async (req, res) => {
  try {
    const b = req.body;
    if (!b.title) return res.status(400).json({ error: 'Ponele un título a tu publicación.' });
    const photos = await uploadClassifiedPhotos(req.files);
    const { data, error } = await supabase.from('classifieds').insert([{
      user_email: req.user.email, user_name: b.user_name || req.user.name || '',
      title: b.title, description: b.description || '', price: Number(b.price) || 0,
      currency: b.currency || 'ARS', condition: b.condition || 'usado', city: b.city || '', photos,
    }]).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al publicar. Probá de nuevo en un momento.' });
  }
});

// Editar / marcar como vendida — solo quien la publicó.
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { data: item } = await supabase.from('classifieds').select('user_email').eq('id', req.params.id).maybeSingle();
    if (!item) return res.status(404).json({ error: 'No encontramos esa publicación.' });
    if (item.user_email !== req.user.email) return res.status(403).json({ error: 'Esta publicación no es tuya.' });
    const b = req.body;
    const updates = {};
    ['title', 'description', 'price', 'currency', 'condition', 'city', 'status'].forEach(f => { if (b[f] !== undefined) updates[f] = b[f]; });
    const { data, error } = await supabase.from('classifieds').update(updates).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al editar la publicación.' });
  }
});

// Borrar — el dueño de la publicación, o cualquiera del personal del panel
// (moderación).
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { data: item } = await supabase.from('classifieds').select('user_email').eq('id', req.params.id).maybeSingle();
    if (!item) return res.status(404).json({ error: 'No encontramos esa publicación.' });
    const isStaff = STAFF_ROLES.includes(req.user.role);
    const isOwner = req.user.email && req.user.email === item.user_email;
    if (!isStaff && !isOwner) return res.status(403).json({ error: 'No podés borrar esta publicación.' });
    const { error } = await supabase.from('classifieds').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al borrar la publicación.' });
  }
});

// ---------- MENSAJES PRIVADOS ----------
// Cada conversación es entre quien publicó y UN interesado puntual — nadie
// más ve esos mensajes (ni siquiera otros interesados en lo mismo).

// Lista de conversaciones de ESTA publicación que le corresponden ver al
// usuario logueado: si es el dueño, ve todas (una por cada interesado); si
// no, solo ve la suya propia con el vendedor.
router.get('/:id/threads', requireAuth, async (req, res) => {
  try {
    const { data: item } = await supabase.from('classifieds').select('user_email').eq('id', req.params.id).maybeSingle();
    if (!item) return res.status(404).json({ error: 'No encontramos esa publicación.' });
    const isOwner = item.user_email === req.user.email;
    const { data: messages } = await supabase.from('classified_messages').select('*').eq('classified_id', req.params.id).order('created_at', { ascending: true });
    if (isOwner) {
      const buyerEmails = [...new Set((messages || []).map(m => m.buyer_email))];
      res.json({ isOwner: true, buyerEmails, messages: messages || [] });
    } else {
      const mine = (messages || []).filter(m => m.buyer_email === req.user.email);
      res.json({ isOwner: false, buyerEmails: [req.user.email], messages: mine });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al buscar los mensajes.' });
  }
});

// Manda un mensaje. Si el que escribe es el dueño, tiene que indicar a
// cuál interesado le está respondiendo (buyer_email); si no, el interesado
// siempre le escribe al dueño y su propia conversación es su propio email.
router.post('/:id/messages', requireAuth, async (req, res) => {
  try {
    const { data: item } = await supabase.from('classifieds').select('user_email').eq('id', req.params.id).maybeSingle();
    if (!item) return res.status(404).json({ error: 'No encontramos esa publicación.' });
    const { message, buyer_email } = req.body;
    if (!message) return res.status(400).json({ error: 'Escribí un mensaje.' });
    const isOwner = item.user_email === req.user.email;
    const finalBuyerEmail = isOwner ? buyer_email : req.user.email;
    if (!finalBuyerEmail) return res.status(400).json({ error: 'Falta indicar a quién responder.' });
    if (!isOwner && item.user_email === req.user.email) return res.status(400).json({ error: 'No podés escribirte a vos mismo.' });

    const { data, error } = await supabase.from('classified_messages').insert([{
      classified_id: req.params.id, buyer_email: finalBuyerEmail, sender_email: req.user.email, message,
    }]).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al enviar el mensaje.' });
  }
});

module.exports = router;
