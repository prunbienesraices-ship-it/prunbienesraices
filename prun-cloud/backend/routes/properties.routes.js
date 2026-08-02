// routes/properties.routes.js
const express = require('express');
const multer = require('multer');
const supabase = require('../supabaseClient');
const { requireAuth } = require('../auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }); // 15MB por foto

// Columnas seguras para mostrar en publico: no incluyen los datos internos
// de servicios (ABL, ARBA, luz, gas, agua), que son solo para uso interno.
const PUBLIC_COLUMNS = 'id, title, description, operation, category, price, currency, address, neighborhood, city, province, bedrooms, bathrooms, area_total, area_covered, garage, status, featured, agent, commission, photos, amenities, owner_id, development_id, floor, door, coefficient, created_at, updated_at';

// ---------- Listar propiedades (publico) ----------
router.get('/', async (req, res) => {
  try {
    const { operation, category, city, minPrice, maxPrice, featured, status } = req.query;
    let query = supabase.from('properties').select(PUBLIC_COLUMNS).order('created_at', { ascending: false });

    if (operation) query = query.eq('operation', operation);
    if (category) query = query.eq('category', category);
    if (city) query = query.ilike('city', `%${city}%`);
    if (minPrice) query = query.gte('price', Number(minPrice));
    if (maxPrice) query = query.lte('price', Number(maxPrice));
    if (featured) query = query.eq('featured', true);
    if (status) query = query.eq('status', status);
    else query = query.not('status', 'in', '(vendido,alquilado)');

    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al buscar propiedades.' });
  }
});

// ---------- Ver una propiedad puntual (publico) ----------
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase.from('properties').select(PUBLIC_COLUMNS).eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: 'Error al buscar la propiedad.' });
  if (!data) return res.status(404).json({ error: 'Propiedad no encontrada.' });
  res.json(data);
});

// ---------- Listar TODAS las propiedades sin filtrar, para uso interno del panel ----------
router.get('/admin/all', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('properties').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Error al buscar propiedades.' });
  res.json(data);
});

// ---------- Crear propiedad (solo admin logueado) ----------
router.post('/', requireAuth, upload.array('photos', 20), async (req, res) => {
  try {
    const b = req.body;
    const photoUrls = await uploadPhotos(req.files);

    const { data, error } = await supabase.from('properties').insert([{
      title: b.title, description: b.description || '', operation: b.operation, category: b.category,
      price: Number(b.price), currency: b.currency || 'USD', address: b.address || '',
      neighborhood: b.neighborhood || '', city: b.city || '', province: b.province || '',
      bedrooms: Number(b.bedrooms) || 0, bathrooms: Number(b.bathrooms) || 0,
      area_total: b.area_total ? Number(b.area_total) : null, area_covered: b.area_covered ? Number(b.area_covered) : null,
      garage: Number(b.garage) || 0, status: b.status || 'disponible', featured: b.featured === 'true' || b.featured === true,
      agent: b.agent || '', commission: Number(b.commission) || 0,
      photos: photoUrls, amenities: b.amenities ? JSON.parse(b.amenities) : [],
      owner_id: b.owner_id ? Number(b.owner_id) : null,
      branch_id: b.branch_id ? Number(b.branch_id) : null,
      services: b.services ? JSON.parse(b.services) : {},
    }]).select().single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear la propiedad.' });
  }
});

// ---------- Editar propiedad (solo admin logueado) ----------
router.put('/:id', requireAuth, upload.array('photos', 20), async (req, res) => {
  try {
    const b = req.body;
    const { data: existing } = await supabase.from('properties').select('photos').eq('id', req.params.id).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Propiedad no encontrada.' });

    const newPhotoUrls = req.files.length ? await uploadPhotos(req.files) : [];
    const finalPhotos = [...(existing.photos || []), ...newPhotoUrls];

    const updates = {};
    ['title','description','operation','category','address','neighborhood','city','province','agent','status'].forEach(f => {
      if (b[f] !== undefined) updates[f] = b[f];
    });
    ['price','bedrooms','bathrooms','area_total','area_covered','garage','commission'].forEach(f => {
      if (b[f] !== undefined) updates[f] = Number(b[f]);
    });
    if (b.owner_id !== undefined) updates.owner_id = b.owner_id ? Number(b.owner_id) : null;
    if (b.branch_id !== undefined) updates.branch_id = b.branch_id ? Number(b.branch_id) : null;
    if (b.featured !== undefined) updates.featured = b.featured === 'true' || b.featured === true;
    if (b.amenities !== undefined) updates.amenities = JSON.parse(b.amenities);
    if (b.services !== undefined) updates.services = JSON.parse(b.services);
    if (newPhotoUrls.length) updates.photos = finalPhotos;
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase.from('properties').update(updates).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al editar la propiedad.' });
  }
});

// ---------- Borrar propiedad (solo admin logueado) ----------
router.delete('/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('properties').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Error al borrar la propiedad.' });
  res.json({ ok: true });
});

// ---------- Helper: sube fotos al bucket de Supabase Storage y devuelve las URLs publicas ----------
async function uploadPhotos(files) {
  if (!files || !files.length) return [];
  const urls = [];
  for (const file of files) {
    const fileName = `${Date.now()}-${Math.round(Math.random()*1e9)}.${file.originalname.split('.').pop()}`;
    const { error } = await supabase.storage.from('property-photos').upload(fileName, file.buffer, {
      contentType: file.mimetype,
    });
    if (error) { console.error('Error subiendo foto:', error); continue; }
    const { data } = supabase.storage.from('property-photos').getPublicUrl(fileName);
    urls.push(data.publicUrl);
  }
  return urls;
}

module.exports = router;
