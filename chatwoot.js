const axios = require('axios');
const FormData = require('form-data');

const api = axios.create({
  baseURL: `http://localhost:3000/api/v1/accounts/${process.env.CHATWOOT_ACCOUNT_ID || 1}`,
  headers: { api_access_token: process.env.CHATWOOT_API_TOKEN }
});

async function findContactByEmail(email) {
  const res = await api.get('/contacts/search', {
    params: { q: email, include_contacts: true }
  });
  const list = res.data.payload || [];
  return list.find(c => c.email === email) || null;
}

async function createContact(name, email) {
  const res = await api.post('/contacts', { name, email });
  return res.data.payload?.contact || res.data;
}

async function getConversations(contactId) {
  const res = await api.get(`/contacts/${contactId}/conversations`);
  return res.data.payload || [];
}

async function getConversation(id) {
  const res = await api.get(`/conversations/${id}`);
  return res.data;
}

async function getMessages(conversationId) {
  const res = await api.get(`/conversations/${conversationId}/messages`);
  const msgs = res.data.payload || [];
  // Sort oldest first, exclude activity messages
  return msgs
    .filter(m => m.message_type !== 2)
    .sort((a, b) => a.created_at - b.created_at);
}

async function createConversation(contactId, subject, priority = 'none') {
  const res = await api.post('/conversations', {
    inbox_id: parseInt(process.env.CHATWOOT_INBOX_ID || 1),
    contact_id: contactId,
    additional_attributes: { mail_subject: subject },
    priority
  });
  return res.data;
}

async function sendMessage(conversationId, content, files = []) {
  if (files.length === 0) {
    const res = await api.post(`/conversations/${conversationId}/messages`, {
      content,
      message_type: 'incoming',
      private: false
    });
    return res.data;
  }

  // Multipart when attachments present
  const form = new FormData();
  form.append('content', content || '');
  form.append('message_type', 'incoming');
  form.append('private', 'false');
  files.forEach(f => {
    form.append('attachments[]', f.buffer, { filename: f.originalname, contentType: f.mimetype });
  });
  const res = await api.post(`/conversations/${conversationId}/messages`, form, {
    headers: form.getHeaders()
  });
  return res.data;
}

async function resolveConversation(id) {
  const res = await api.patch(`/conversations/${id}`, { status: 'resolved' });
  return res.data;
}

module.exports = {
  findContactByEmail,
  createContact,
  getConversations,
  getConversation,
  getMessages,
  createConversation,
  sendMessage,
  resolveConversation
};
