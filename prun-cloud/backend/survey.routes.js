// routes/survey.routes.js
const express = require('express');
const bcrypt = require('bcryptjs');
const supabase = require('../supabaseClient');

const router = express.Router();

// A partir de lo que responde en "Que estas buscando?", clasificamos
// automaticamente en comprador, inquilino o propietario.
function deriveCategory(interest) {
  if (interest === 'alquilar') return 'inquilino';
  if (interest === 'vender') return 'propietario';
  if (interest === 'comprar') return 'comprador';
  if (interest === 'invertir') return 'inversor';
  return '';
}
const CATEGORY_LABELS = { comprador: 'Comprador', inquilino: 'Inquilino', propietario: 'Propietario', inversor: 'Inversor' };

// Publico: un visitante completa el cuestionario para agendarse.
// Si manda contrasena, tambien le crea la cuenta. Ademas, genera
// automaticamente un lead en el Pipeline de Ventas, y si se clasifica
// como "propietario" (quiere vender/poner en alquiler su propiedad),
// tambien lo deriva a la ficha de Propietarios para que el personal
// no tenga que volver a cargar sus datos a mano.
router.post('/', async (req, res) => {
  try {
    const { name, email, phone, password, interest, budget, timeline, property_id, preferred_date, notes, extra_details } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: 'Nombre y email son obligatorios.' });
    }

    const category = deriveCategory(interest);
    const categoryLabel = CATEGORY_LABELS[category] || '';
    const extra = extra_details || {};

    let userId = null;
    if (password) {
      const { data: existing } = await supabase.from('site_users').select('id').eq('email', email).maybeSingle();
      if (existing) {
        userId = existing.id;
      } else {
        const password_hash = bcrypt.hashSync(password, 10);
        const { data: newUser, error: userErr } = await supabase.from('site_users')
          .insert([{ name, email, password_hash, phone: phone || '', role: category === 'propietario' ? 'owner' : 'client' }])
          .select().single();
        if (userErr) throw userErr;
        userId = newUser.id;
      }
    }

    const { data: survey, error: surveyErr } = await supabase.from('survey_responses').insert([{
      user_id: userId, name, email, phone: phone || '', interest: interest || '', budget: budget || '',
      timeline: timeline || '', property_id: property_id || null, preferred_date: preferred_date || null,
      notes: notes || '', category, extra_details: extra,
    }]).select().single();
    if (surveyErr) throw surveyErr;

    // Si es una busqueda de alquiler o de compra, armamos el detalle para
    // que el personal lo vea de un vistazo en la nota del lead.
    let rentalDetails = '';
    if (category === 'inquilino' && Object.keys(extra).length) {
      rentalDetails = ` | Localidad: ${extra.localidad||'-'}. Zona: ${extra.zona||'-'}. Alquiler: ${extra.alquiler_desde||'-'} a ${extra.alquiler_hasta||'-'}. Tipo: ${extra.tipo_propiedad||'-'}. Habitaciones: ${extra.habitaciones||'-'}. m²: ${extra.m2||'-'}. Grupo familiar: ${extra.grupo_familiar||'-'} personas. Ingresos: ${extra.ingresos||'-'}. Garantía: ${extra.garantia||'-'}. Mascotas: ${extra.mascotas||'-'}. Fecha de mudanza deseada: ${extra.fecha_mudanza||'-'}.`;
    }
    if (category === 'comprador' && Object.keys(extra).length) {
      rentalDetails = ` | Localidad: ${extra.localidad||'-'}. Zona: ${extra.zona||'-'}. Presupuesto: ${extra.presupuesto_desde||'-'} a ${extra.presupuesto_hasta||'-'}. Tipo de vivienda: ${extra.tipo_vivienda||'-'}. Habitaciones: ${extra.habitaciones||'-'}. m²: ${extra.m2||'-'}. Forma de pago: ${extra.forma_pago||'-'}. Cochera: ${extra.cochera||'-'}. Antigüedad preferida: ${extra.antiguedad||'-'}.`;
    }

    // Crea el lead automaticamente en el Pipeline de Ventas, ya clasificado.
    await supabase.from('deals').insert([{
      property_id: property_id || null, name, phone: phone || '', email, amount: 0, agent: '', stage: 'lead',
      category,
      notes: `[${categoryLabel || 'Consulta general'}] Se agendo desde el sitio. Busca: ${interest || '-'}. Presupuesto: ${budget || '-'}. Plazo: ${timeline || '-'}.${preferred_date ? ' Fecha preferida: '+preferred_date+'.' : ''}${rentalDetails}`,
      history: [{ stage: 'lead', date: new Date().toISOString(), user: 'Sitio web' }],
    }]);

    // Si se clasifica como propietario (quiere vender o poner en alquiler su
    // propiedad), lo derivamos automaticamente a la ficha de Propietarios,
    // para que el personal ya lo encuentre cargado ahi, listo para completar.
    let derivedToOwners = false;
    if (category === 'propietario') {
      const { data: existingOwner } = await supabase.from('owners').select('id').eq('email', email).maybeSingle();
      if (!existingOwner) {
        await supabase.from('owners').insert([{
          name, phone: phone || '', email,
          notes: `Derivado automaticamente desde el cuestionario "Agendarme" del sitio. Quiere vender/alquilar una propiedad. Presupuesto/valor mencionado: ${budget || '-'}. Plazo: ${timeline || '-'}.`,
        }]);
        derivedToOwners = true;
      }
    }

    res.status(201).json({ ok: true, accountCreated: !!password, category, derivedToOwners, survey });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar tu solicitud. Proba de nuevo en un momento.' });
  }
});

module.exports = router;
