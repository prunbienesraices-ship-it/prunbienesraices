// mailer.js
// Envio de emails reales usando Brevo (antes Sendinblue) por su API HTTPS,
// en vez de SMTP tradicional -- Render (en el plan gratuito) no permite
// conexiones SMTP salientes, por eso el envio se quedaba "colgado" y nunca
// llegaba. La API por HTTPS si funciona sin problemas.
//
// Se configura con 2 variables de entorno en Render:
//   BREVO_API_KEY   -> la clave que genera Brevo en su panel
//   EMAIL_USER      -> el mail remitente (debe estar verificado en Brevo)
//
// Pasos para configurarlo (una sola vez):
//   1. Crear cuenta gratis en https://www.brevo.com
//   2. Ahi mismo, verificar como "Sender" (remitente) el mail que va a
//      figurar como remitente (ej: prunbienesraices@gmail.com) -- Brevo
//      manda un mail de confirmacion a esa casilla, hay que abrirlo y
//      confirmar. No hace falta tener dominio propio.
//   3. En Brevo: menu de la izquierda -> SMTP & API -> API Keys -> "Generate
//      a new API key". Copiar esa clave.
//   4. En Render -> Environment -> agregar BREVO_API_KEY (la clave) y
//      EMAIL_USER (el mail que verificaste en el paso 2).

async function sendMail({ to, subject, html }) {
  if (!process.env.BREVO_API_KEY || !process.env.EMAIL_USER) {
    throw new Error('Falta configurar el envío de emails: agregá BREVO_API_KEY y EMAIL_USER en las variables de entorno de Render.');
  }
  console.log(`[mailer] Intentando enviar mail a: ${to} — desde: ${process.env.EMAIL_USER}`);

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: process.env.EMAIL_FROM_NAME || 'Prun Bienes Raíces', email: process.env.EMAIL_USER },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`[mailer] ERROR al enviar (Brevo respondió ${res.status}) -> ${JSON.stringify(data)}`);
    throw new Error(data.message || `Error al enviar el email (código ${res.status}).`);
  }
  console.log(`[mailer] Enviado OK -> messageId=${data.messageId}`);
  return data;
}

module.exports = { sendMail };
