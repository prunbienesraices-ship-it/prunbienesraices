// routes/contract.routes.js
const express = require('express');
const supabase = require('../supabaseClient');
const { requireAuth } = require('../auth');
const { Document, Packer, Paragraph, TextRun, AlignmentType } = require('docx');

const router = express.Router();

const MONTHS_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

function fmtDateWords(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getDate()} de ${MONTHS_ES[d.getMonth()]} de ${d.getFullYear()}`;
}
function fmtMoney(n, currency) {
  return `${currency || 'ARS'} ${Number(n || 0).toLocaleString('es-AR')}`;
}
function monthsBetween(startStr, endStr) {
  const start = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  return Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24 * 30.44)));
}
const NUM_WORDS = ['cero','un','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez'];
function numWord(n) { return NUM_WORDS[n] || String(n); }
// Arma la composicion del inmueble a partir de los datos que ya se cargan en
// el formulario de la propiedad (dormitorios, baños, cochera), y le suma el
// detalle adicional que se haya escrito a mano (patio, balcón, etc.).
function buildComposition(property) {
  if (!property) return '(sin composición cargada)';
  const parts = [];
  if (property.bedrooms) parts.push(`${numWord(property.bedrooms)} dormitorio${property.bedrooms > 1 ? 's' : ''}`);
  if (property.bathrooms) parts.push(`${numWord(property.bathrooms)} baño${property.bathrooms > 1 ? 's' : ''}`);
  if (property.garage) parts.push(`${property.garage > 1 ? numWord(property.garage) : 'una'} cochera${property.garage > 1 ? 's' : ''}`);
  let base = parts.join(', ');
  if (property.composition) base = base ? `${base}, ${property.composition}` : property.composition;
  return base || '(sin composición cargada)';
}
// Convierte un texto (que puede tener varios renglones separados por \n)
// en parrafos de Word. El primer parrafo puede llevar un titulo en negrita.
function textToParagraphs(text, title) {
  const rawLines = String(text || '').split('\n');
  const lines = [];
  let lastWasBlank = true; // para no arrancar con una linea en blanco
  rawLines.forEach(l => {
    const trimmed = l.trim();
    if (!trimmed) {
      if (!lastWasBlank) { lines.push(''); lastWasBlank = true; }
    } else {
      lines.push(trimmed);
      lastWasBlank = false;
    }
  });
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (!lines.length) return [];
  return lines.map((line, i) => new Paragraph({
    spacing: { after: line === '' ? 400 : 200 },
    children: i === 0 && title
      ? [new TextRun({ text: title + ': ', bold: true }), new TextRun({ text: line })]
      : [new TextRun({ text: line })],
  }));
}
// Reemplaza los {{TOKENS}} de un texto por los valores correspondientes.
function fillTokens(text, tokens) {
  let out = String(text || '');
  Object.keys(tokens).forEach(key => {
    out = out.split(`{{${key}}}`).join(tokens[key]);
  });
  return out;
}

router.get('/tenants/:id/contract', requireAuth, async (req, res) => {
  try {
    const { data: tenant, error: tenantErr } = await supabase.from('tenants').select('*').eq('id', req.params.id).maybeSingle();
    if (tenantErr) throw tenantErr;
    if (!tenant) return res.status(404).json({ error: 'Contrato no encontrado.' });

    const { data: property } = await supabase.from('properties').select('*').eq('id', tenant.property_id).maybeSingle();
    let owner = null;
    if (property && property.owner_id) {
      const { data: ownerData } = await supabase.from('owners').select('*').eq('id', property.owner_id).maybeSingle();
      owner = ownerData;
    }
    const { data: template, error: templateErr } = await supabase.from('contract_template').select('*').eq('id', 1).maybeSingle();
    if (templateErr) throw templateErr;
    if (!template || !template.clauses || !template.clauses.length) {
      return res.status(400).json({ error: 'Todavía no hay un modelo de contrato cargado. Pedile al Administrador que lo cargue en "Modelo de contrato".' });
    }

    const propAddress = property && property.address
      ? `${property.address}${property.city ? ', ' + property.city : ''}`
      : '(FALTA CARGAR LA DIRECCIÓN DE ESTA PROPIEDAD — completala en Propiedades → Editar)';
    const durationMonths = monthsBetween(tenant.start_date, tenant.end_date);
    const rentHistory = (tenant.rent_history && tenant.rent_history.length) ? tenant.rent_history : [];
    const guarantors = tenant.guarantors || [];
    const inventory = (property && property.inventory) || [];
    const today = new Date();

    const FREQ_LABELS = { bimestral: 'dos (2) meses', trimestral: 'tres (3) meses', cuatrimestral: 'cuatro (4) meses', semestral: 'seis (6) meses', anual: 'doce (12) meses' };
    const INDEX_LABELS = { ICL: 'Índice para Contratos de Locación (ICL) publicado por el Banco Central de la República Argentina', IPC: 'Índice de Precios al Consumidor (IPC) publicado por el INDEC', libre: 'índice acordado libremente entre las partes' };

    let detalleAlquiler;
    if (tenant.rent_type === 'indice') {
      const initialAmount = rentHistory.length ? rentHistory[0].amount : tenant.contract_total_amount;
      detalleAlquiler = `El valor locativo mensual inicial es de ${fmtMoney(initialAmount, tenant.currency)}, el cual se actualizará cada ${FREQ_LABELS[tenant.update_freq] || tenant.update_freq}, conforme a la variación del ${INDEX_LABELS[tenant.update_index] || tenant.update_index}, en los términos del artículo 14 de la Ley 27.551 de Alquileres.`;
    } else {
      detalleAlquiler = rentHistory.length
        ? rentHistory.map(r => `A partir del ${fmtDateWords(r.date)}: cuota mensual de ${fmtMoney(r.amount, tenant.currency)}.`).join('\n')
        : '(No se cargó el historial de montos del alquiler).';
    }
    const fiadoresDetalle = guarantors.length
      ? guarantors.map(g => `${g.name}${g.dni ? ', DNI Nº ' + g.dni : ''}${g.address ? ', con domicilio en ' + g.address : ''}${g.email ? ', mail ' + g.email : ''}`).join('; ') + '.'
      : '(No se cargaron garantes para este contrato).';
    const inventarioDetalle = inventory.length
      ? inventory.map(i => `${(i.room || '').toUpperCase()}: ${i.detail}.`).join('\n')
      : '(No se cargó el inventario de la propiedad).';
    const fiadoresFirmas = guarantors.length
      ? guarantors.map(g => `${g.name}\nDNI ${g.dni || '(sin DNI cargado)'}\n(GARANTE)`).join('\n\n\n')
      : '';

    const tokens = {
      PROPIETARIO_NOMBRE: owner ? owner.name : '(propietario no asignado a esta propiedad)',
      PROPIETARIO_DNI: (owner && owner.dni) || '(sin DNI cargado)',
      PROPIETARIO_DOMICILIO: (owner && owner.address) || '(sin domicilio cargado)',
      INQUILINO_NOMBRE: tenant.name,
      INQUILINO_DNI: tenant.dni || '(sin DNI cargado)',
      INQUILINO_EMAIL: tenant.email || '(sin email cargado)',
      PROPIEDAD_DIRECCION: propAddress,
      PROPIEDAD_CIUDAD: (property && property.city) || '(sin ciudad cargada)',
      PROPIEDAD_COMPOSICION: buildComposition(property),
      FECHA_INICIO: fmtDateWords(tenant.start_date),
      FECHA_FIN: fmtDateWords(tenant.end_date),
      DURACION_MESES: String(durationMonths),
      MONTO_TOTAL: fmtMoney(tenant.contract_total_amount, tenant.currency),
      DETALLE_ALQUILER: detalleAlquiler,
      FIADORES_DETALLE: fiadoresDetalle,
      INVENTARIO_DETALLE: inventarioDetalle,
      FECHA_FIRMA: `${today.getDate()} días del mes de ${MONTHS_ES[today.getMonth()]} de ${today.getFullYear()}`,
      FIADORES_FIRMAS: fiadoresFirmas,
    };

    const children = [
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 300 },
        children: [new TextRun({ text: '________________CONTRATO DE LOCACION________________', bold: true, size: 24 })] }),
      ...textToParagraphs(fillTokens(template.intro, tokens)),
      ...template.clauses.flatMap(c => textToParagraphs(fillTokens(c.body, tokens), c.title)),
      new Paragraph({ spacing: { before: 400 }, children: [new TextRun({ text: '' })] }),
      ...textToParagraphs(fillTokens(template.signature_block, tokens)),
    ];

    const doc = new Document({ sections: [{ children }] });
    const buffer = await Packer.toBuffer(doc);

    const safeName = (property ? property.title : tenant.name).replace(/[^a-zA-Z0-9]+/g, '_');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="Contrato_${safeName}.docx"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al generar el contrato.' });
  }
});

module.exports = router;
