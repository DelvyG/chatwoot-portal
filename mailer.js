const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_ADDRESS,
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USERNAME,
    pass: process.env.SMTP_PASSWORD
  },
  tls: { rejectUnauthorized: false }
});

async function sendMagicLink(email, link, t) {
  await transporter.sendMail({
    from: `"Towa Agency Support" <${process.env.MAILER_FROM || 'support@towa.agency'}>`,
    to: email,
    subject: t.magicLinkSubject,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#f8fafc;border-radius:8px">
        <img src="https://support.towa.agency/brand-assets/logo.png" alt="Towa" style="height:36px;margin-bottom:24px">
        <h2 style="color:#1e293b;margin:0 0 12px">${t.magicLinkTitle}</h2>
        <p style="color:#475569;margin:0 0 24px">${t.magicLinkText}</p>
        <a href="${link}"
           style="display:inline-block;padding:12px 28px;background:#1f93ff;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px">
          ${t.magicLinkButton}
        </a>
        <p style="color:#94a3b8;font-size:12px;margin-top:28px">${t.magicLinkExpiry}</p>
      </div>
    `
  });
}

module.exports = { sendMagicLink };
