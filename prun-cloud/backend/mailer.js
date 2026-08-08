// mailer.js
// Envio de emails reales, usando una cuenta de Gmail (o cualquier SMTP) que
// se configura con 2 variables de entorno en Render: EMAIL_USER y EMAIL_PASS.
// EMAIL_PASS no es la contraseña normal de Gmail, es una "contraseña de
// aplicacion" que Google genera aparte (ver instrucciones en el README).
const nodemailer = require('nodemailer');

let transporter = null;
function getTransporter() {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    throw new Error('Falta configurar el envío de emails: agregá EMAIL_USER y EMAIL_PASS en las variables de entorno de Render.');
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
  }
  return transporter;
}

async function sendMail({ to, subject, html }) {
  const t = getTransporter();
  console.log(`[mailer] Intentando enviar mail a: ${to} — desde: ${process.env.EMAIL_USER}`);
  const info = await t.sendMail({
    from: `"${process.env.EMAIL_FROM_NAME || 'Prun Bienes Raíces'}" <${process.env.EMAIL_USER}>`,
    to, subject, html, encoding: 'utf-8',
  });
  console.log(`[mailer] Respuesta de Gmail: messageId=${info.messageId} — accepted=${JSON.stringify(info.accepted)} — rejected=${JSON.stringify(info.rejected)} — response=${info.response}`);
  return info;
}

module.exports = { sendMail };
