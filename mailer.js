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

async function sendReplyNotification(email, { agentName, content, subject, link, ticketId }) {
  const preview = content.length > 320 ? content.slice(0, 320) + '…' : content;
  await transporter.sendMail({
    from: `"Towa Agency Support" <${process.env.MAILER_FROM || 'support@towa.agency'}>`,
    to: email,
    subject: `Re: ${subject}`,
    html: `
      <div style="font-family:sans-serif;max-width:540px;margin:0 auto;padding:0;background:#f8fafc">
        <div style="background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)">
          <div style="background:#1f93ff;padding:24px 32px">
            <img src="https://support.towa.agency/brand-assets/logo.png" alt="Towa" style="height:32px">
          </div>
          <div style="padding:32px">
            <p style="color:#64748b;font-size:13px;margin:0 0 6px">Ticket #${ticketId}</p>
            <h2 style="color:#1e293b;font-size:18px;margin:0 0 20px;font-weight:700">${subject}</h2>

            <p style="color:#475569;margin:0 0 16px;font-size:14px">
              <strong>${agentName}</strong> has replied to your support ticket:
            </p>

            <div style="background:#f1f5f9;border-left:3px solid #1f93ff;border-radius:4px;padding:14px 18px;margin:0 0 28px">
              <p style="color:#334155;font-size:14px;line-height:1.6;margin:0;white-space:pre-wrap">${preview}</p>
            </div>

            <a href="${link}"
               style="display:inline-block;padding:13px 28px;background:#1f93ff;color:#ffffff;border-radius:7px;text-decoration:none;font-weight:700;font-size:15px">
              View Ticket →
            </a>
          </div>
          <div style="padding:20px 32px;border-top:1px solid #e2e8f0">
            <p style="color:#94a3b8;font-size:12px;margin:0;line-height:1.5">
              You received this email because you have an open support ticket at
              <a href="${process.env.PORTAL_URL}/portal" style="color:#1f93ff;text-decoration:none">Towa Support Portal</a>.
            </p>
          </div>
        </div>
      </div>
    `
  });
}

module.exports = { sendMagicLink, sendReplyNotification };
