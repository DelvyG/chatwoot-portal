require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const chatwoot = require('./chatwoot');
const mailer = require('./mailer');
const i18n = require('./i18n');

const ALLOWED_MIMES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain'
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter(req, file, cb) {
    cb(null, ALLOWED_MIMES.includes(file.mimetype));
  }
});

const app = express();
const PORT = process.env.PORT || 3001;
const BASE = '/portal';

// Token store: { token -> { email, expires } }
const tokenStore = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of tokenStore) {
    if (v.expires < now) tokenStore.delete(k);
  }
}, 60 * 1000);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(`${BASE}/public`, express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  rolling: true, // reset timer on each request (inactivity-based)
  cookie: { secure: false, maxAge: 4 * 60 * 60 * 1000 } // 4 hours inactivity
}));

// i18n + locals middleware
app.use((req, res, next) => {
  const lang = req.session.lang || 'en';
  res.locals.t = i18n[lang] || i18n.en;
  res.locals.lang = lang;
  res.locals.BASE = BASE;
  res.locals.user = req.session.user || null;
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect(`${BASE}/`);
  next();
}

// ── Login ──────────────────────────────────────────────────────────────
app.get(`${BASE}/`, (req, res) => {
  if (req.session.user) return res.redirect(`${BASE}/dashboard`);
  res.render('login', { error: null, message: null });
});

app.post(`${BASE}/auth/request`, async (req, res) => {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.render('login', { error: res.locals.t.invalidEmail, message: null });
  }

  // Only allow registered contacts
  try {
    const contact = await chatwoot.findContactByEmail(email);
    if (!contact) {
      console.log(`[portal] Access denied for unknown email: ${email}`);
      return res.render('login', { error: res.locals.t.notRegistered, message: null });
    }
  } catch (err) {
    console.error('[portal] Contact lookup error:', err.message);
    return res.render('login', { error: res.locals.t.emailError, message: null });
  }

  const token = crypto.randomBytes(32).toString('hex');
  tokenStore.set(token, { email, expires: Date.now() + 15 * 60 * 1000 });

  const link = `${process.env.PORTAL_URL || 'https://support.towa.agency'}${BASE}/auth/verify?token=${token}`;

  try {
    await mailer.sendMagicLink(email, link, res.locals.t);
    console.log(`[portal] Magic link sent to ${email}`);
    res.render('login', { error: null, message: res.locals.t.magicLinkSent });
  } catch (err) {
    console.error('[portal] Email error:', err.message);
    res.render('login', { error: res.locals.t.emailError, message: null });
  }
});

// GET: muestra página de confirmación — NO consume el token
// (evita que Safe Links de Microsoft/Outlook invalide el token al pre-escanear la URL)
app.get(`${BASE}/auth/verify`, (req, res) => {
  const { token, redirect } = req.query;
  const record = tokenStore.get(token);
  if (!record || record.expires < Date.now()) {
    tokenStore.delete(token);
    return res.render('login', { error: res.locals.t.invalidToken, message: null });
  }
  res.render('confirm', { token, redirect: redirect || '' });
});

// POST: el usuario hace clic en el botón — AHÍ sí se consume el token y se crea la sesión
app.post(`${BASE}/auth/verify`, (req, res) => {
  const { token, redirect } = req.body;
  const record = tokenStore.get(token);
  if (!record || record.expires < Date.now()) {
    tokenStore.delete(token);
    return res.render('login', { error: res.locals.t.invalidToken, message: null });
  }
  tokenStore.delete(token);
  req.session.user = { email: record.email };
  if (redirect && redirect.startsWith(`${BASE}/`)) {
    return res.redirect(redirect);
  }
  res.redirect(`${BASE}/dashboard`);
});

// ── Dashboard ──────────────────────────────────────────────────────────
app.get(`${BASE}/dashboard`, requireAuth, async (req, res) => {
  try {
    const contact = await chatwoot.findContactByEmail(req.session.user.email);
    let conversations = [];
    if (contact) {
      conversations = await chatwoot.getConversations(contact.id);
      req.session.user.contactId = contact.id;
      req.session.user.name = contact.name;
    }
    res.render('dashboard', { conversations, error: null });
  } catch (err) {
    console.error('Dashboard error:', err.message);
    res.render('dashboard', { conversations: [], error: res.locals.t.loadError });
  }
});

// ── Create ticket ──────────────────────────────────────────────────────
app.get(`${BASE}/tickets/new`, requireAuth, (req, res) => {
  res.render('create', { error: null });
});

const VALID_PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'];

app.post(`${BASE}/tickets`, requireAuth, upload.array('attachments', 6), async (req, res) => {
  const { subject, message } = req.body;
  const priority = VALID_PRIORITIES.includes(req.body.priority) ? req.body.priority : 'none';
if (!subject || !message) {
    return res.render('create', { error: res.locals.t.fillAllFields });
  }
  try {
    let contact = await chatwoot.findContactByEmail(req.session.user.email);
    if (!contact) {
      const name = req.session.user.name || req.session.user.email.split('@')[0];
      contact = await chatwoot.createContact(name, req.session.user.email);
    }
    const conversation = await chatwoot.createConversation(contact.id, subject, priority);
    await chatwoot.sendMessage(conversation.id, message, req.files || []);
    res.redirect(`${BASE}/tickets/${conversation.id}`);
  } catch (err) {
    console.error('Create ticket error:', err.message, err.response?.data);
    res.render('create', { error: res.locals.t.createError });
  }
});

// ── Ticket detail ──────────────────────────────────────────────────────
app.get(`${BASE}/tickets/:id`, requireAuth, async (req, res) => {
  try {
    const conversation = await chatwoot.getConversation(req.params.id);
    const contact = await chatwoot.findContactByEmail(req.session.user.email);
    if (!contact || conversation.meta?.sender?.id !== contact.id) {
      return res.redirect(`${BASE}/dashboard`);
    }
    const messages = await chatwoot.getMessages(req.params.id);
    res.render('ticket', { conversation, messages, error: null });
  } catch (err) {
    console.error('Ticket error:', err.message);
    res.redirect(`${BASE}/dashboard`);
  }
});

// ── Reply ──────────────────────────────────────────────────────────────
app.post(`${BASE}/tickets/:id/reply`, requireAuth, upload.array('attachments', 6), async (req, res) => {
  const { message } = req.body;
  const files = req.files || [];
  if (!message?.trim() && files.length === 0) {
    return res.redirect(`${BASE}/tickets/${req.params.id}`);
  }
  try {
    const conversation = await chatwoot.getConversation(req.params.id);
    const contact = await chatwoot.findContactByEmail(req.session.user.email);
    if (!contact || conversation.meta?.sender?.id !== contact.id) {
      return res.redirect(`${BASE}/dashboard`);
    }
    await chatwoot.sendMessage(req.params.id, message || '', files);
    res.redirect(`${BASE}/tickets/${req.params.id}`);
  } catch (err) {
    console.error('Reply error:', err.message);
    res.redirect(`${BASE}/tickets/${req.params.id}`);
  }
});

// ── Cancel ticket ──────────────────────────────────────────────────────
app.post(`${BASE}/tickets/:id/cancel`, requireAuth, async (req, res) => {
  try {
    const conversation = await chatwoot.getConversation(req.params.id);
    const contact = await chatwoot.findContactByEmail(req.session.user.email);
    if (!contact || conversation.meta?.sender?.id !== contact.id) {
      return res.redirect(`${BASE}/dashboard`);
    }
    await chatwoot.resolveConversation(req.params.id);
    res.redirect(`${BASE}/dashboard`);
  } catch (err) {
    console.error('Cancel error:', err.message);
    res.redirect(`${BASE}/dashboard`);
  }
});

// ── Language switch ────────────────────────────────────────────────────
app.post(`${BASE}/lang`, (req, res) => {
  const { lang } = req.body;
  if (['en', 'es'].includes(lang)) req.session.lang = lang;
  const ref = req.get('Referer') || `${BASE}/dashboard`;
  res.redirect(ref);
});

// ── Chatwoot webhook (agent reply notifications) ────────────────────────
app.post(`${BASE}/webhooks/chatwoot`, async (req, res) => {
  res.sendStatus(200); // always ack quickly

  const payload = req.body;

  console.log(`[webhook] event=${payload.event} message_type=${payload.message_type} private=${payload.private} inbox_id=${payload.conversation?.inbox_id} email=${payload.conversation?.meta?.sender?.email}`);

  // Only care about new messages
  if (payload.event !== 'message_created') return;
  // Only outgoing messages from agents (type 1 or "outgoing"), skip private notes
  if (payload.message_type !== 1 && payload.message_type !== 'outgoing') return;
  if (payload.private === true) return;
  // Only notify for our Customer Portal inbox
  const inboxId = parseInt(process.env.CHATWOOT_INBOX_ID || 2);
  if (payload.conversation?.inbox_id !== inboxId) return;

  const email = payload.conversation?.meta?.sender?.email;
  if (!email) return;

  const conversationId = payload.conversation?.id;
  const ticketId       = conversationId;
  const subject        = payload.conversation?.additional_attributes?.mail_subject
                         || `Ticket #${conversationId}`;
  const agentName      = payload.sender?.name || 'Support Agent';
  const content        = payload.content || '';
  const autoToken      = crypto.randomBytes(32).toString('hex');
  tokenStore.set(autoToken, { email, expires: Date.now() + 24 * 60 * 60 * 1000 }); // 24h
  const link           = `${process.env.PORTAL_URL || 'https://support.towa.agency'}${BASE}/auth/verify?token=${autoToken}&redirect=${BASE}/tickets/${conversationId}`;

  try {
    await mailer.sendReplyNotification(email, { agentName, content, subject, link, ticketId });
    console.log(`[portal] Reply notification → ${email} (ticket #${ticketId})`);
  } catch (err) {
    console.error('[portal] Notification error:', err.message);
  }
});

// ── Logout ─────────────────────────────────────────────────────────────
app.get(`${BASE}/logout`, (req, res) => {
  req.session.destroy();
  res.redirect(`${BASE}/`);
});

app.listen(PORT, () => console.log(`Portal running on port ${PORT}`));
