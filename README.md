# Chatwoot Customer Portal

A self-hosted customer portal that sits on top of [Chatwoot](https://www.chatwoot.com/), giving your clients a clean web interface to create tickets, track their status, reply, and cancel — without needing access to the Chatwoot agent dashboard.

**Live demo:** `https://support.towa.agency/portal`

---

## Features

- **Magic link authentication** — customers sign in via a one-time link sent to their email (no passwords)
- **Ticket dashboard** — lists all conversations for the logged-in contact with status badges (Open, Pending, Resolved, Snoozed)
- **Create tickets** — subject + message form, creates a Chatwoot conversation via API
- **Ticket detail & reply** — full message thread with support-agent replies, customer can send follow-ups
- **Cancel ticket** — customer can resolve/close their own ticket
- **Bilingual UI** — English (default) and Spanish, switchable at any time
- **Rolling session** — 30-minute inactivity timeout, session resets on each request
- **Brand-ready** — logo and favicon served from Chatwoot's brand-assets volume

---

## Architecture

```
Customer browser
      │
      ▼
Nginx (support.yourdomain.com)
  ├── /portal  →  Node.js portal app  (port 3001)
  └── /        →  Chatwoot             (port 3000)

Portal app
  ├── Express + EJS templates
  ├── express-session (in-memory, rolling 30 min)
  ├── Magic link tokens (in-memory Map, 15 min TTL)
  ├── Chatwoot REST API  (contacts + conversations)
  └── Nodemailer SMTP    (magic link emails)
```

The portal uses **two Chatwoot inboxes**:

| Inbox | Type | Purpose |
|-------|------|---------|
| Soporte Email | Channel::Email (IMAP) | Receives emails sent directly to support@ |
| Customer Portal | Channel::Api | Receives tickets created from the portal |

---

## Prerequisites

- A running **Chatwoot** instance (self-hosted or cloud)
- **Node.js 18+** on the server
- An SMTP account for sending magic link emails (Gmail app password, etc.)
- **Nginx** (or another reverse proxy) to serve everything under one domain

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/DelvyG/chatwoot-portal.git
cd chatwoot-portal
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

```bash
cp .env.example .env
nano .env
```

Fill in all values — see the [Environment Variables](#environment-variables) section below.

### 4. Create a Chatwoot API inbox

In your Chatwoot dashboard:

1. Go to **Settings → Inboxes → Add Inbox**
2. Choose **API** as the channel type
3. Name it `Customer Portal` (or anything you like)
4. Copy the **Inbox ID** — you'll need it for `CHATWOOT_INBOX_ID`

### 5. Get your Chatwoot API token

1. Go to **Settings → Integrations → API Access Token**
2. Copy the token and set it as `CHATWOOT_API_TOKEN`

### 6. Start the portal

**With PM2 (recommended for production):**

```bash
npm install -g pm2
pm2 start server.js --name portal
pm2 save
pm2 startup   # follow the printed command to enable auto-start on reboot
```

**Without PM2 (testing only):**

```bash
node server.js
```

The server listens on `PORT` (default `3001`).

---

## Nginx Configuration

Add a location block inside your existing Chatwoot server block:

```nginx
# Map for WebSocket upgrades (add near the top of nginx.conf or http block)
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    server_name support.yourdomain.com;

    # ... your SSL config ...

    # Customer Portal
    location /portal {
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    # Chatwoot WebSocket
    location /cable {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection $connection_upgrade;
        proxy_set_header   Host       $host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # Chatwoot main app
    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

Reload Nginx:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Port to listen on (default: `3001`) |
| `SESSION_SECRET` | Yes | Random string used to sign session cookies |
| `CHATWOOT_API_TOKEN` | Yes | Chatwoot user API access token |
| `CHATWOOT_ACCOUNT_ID` | No | Chatwoot account ID (default: `1`) |
| `CHATWOOT_INBOX_ID` | Yes | ID of the **API-type** inbox in Chatwoot |
| `PORTAL_URL` | Yes | Public base URL, e.g. `https://support.yourdomain.com` |
| `SMTP_ADDRESS` | Yes | SMTP server hostname |
| `SMTP_PORT` | No | SMTP port (default: `587`) |
| `SMTP_USERNAME` | Yes | SMTP login (usually your email address) |
| `SMTP_PASSWORD` | Yes | SMTP password or app password |
| `SMTP_FROM` | No | From address in emails (defaults to `SMTP_USERNAME`) |

---

## How It Works

### Authentication flow

```
1. Customer enters email → POST /portal/auth/request
2. Server checks if email exists as a Chatwoot contact
   └── Not found → show "not registered" error
3. Server generates a 32-byte random token, stores it with 15-min expiry
4. Magic link email sent: https://support.yourdomain.com/portal/auth/verify?token=...
5. Customer clicks link → GET /portal/auth/verify
6. Token validated, deleted, session created
7. Redirect to /portal/dashboard
```

Only customers who already exist as **Chatwoot contacts** can log in. This prevents random signups — you control access by adding contacts in Chatwoot.

### Ticket flow

```
Create:  POST /portal/tickets
         → chatwoot.createConversation(contactId, subject)
         → chatwoot.sendMessage(conversationId, message)

Reply:   POST /portal/tickets/:id/reply
         → chatwoot.sendMessage(conversationId, message)

Cancel:  POST /portal/tickets/:id/cancel
         → chatwoot.resolveConversation(conversationId)
```

All API calls verify that the conversation belongs to the logged-in contact before executing.

---

## Adding a New Customer

Customers must exist as Chatwoot contacts before they can log in:

1. In Chatwoot → **Contacts → New Contact**
2. Enter the customer's name and email
3. Save — they can now request a magic link

Alternatively, contacts are created automatically when a customer emails your support address directly (via the IMAP inbox).

---

## Branding / Logo

The portal loads logo and favicon from Chatwoot's brand-assets directory:

| Asset | Path (inside container) | Used for |
|-------|--------------------------|---------|
| Logo | `/app/public/brand-assets/logo.png` | Login page + navbar |
| Favicon | `/app/public/brand-assets/logo_thumbnail.png` | Browser tab icon |

If you mount brand assets via Docker volume (e.g., `/opt/chatwoot/brand-assets:/app/public/brand-assets`), just replace the files there. Add a version query string (e.g., `?v=2`) to bust the browser cache after updating.

---

## Localization

Strings are in `i18n.js`. To add a new language:

1. Add a new key (e.g., `fr`) alongside `en` and `es`
2. Update the language toggle in `views/login.ejs` and `views/_header.ejs`
3. Add the new lang value to the allowlist in `server.js` (`/portal/lang` route)

---

## Project Structure

```
chatwoot-portal/
├── server.js          # Express app, routes, session, auth
├── chatwoot.js        # Chatwoot REST API client (axios)
├── mailer.js          # Nodemailer SMTP — magic link emails
├── i18n.js            # EN / ES translation strings
├── package.json
├── .env.example       # Environment variable template
├── public/
│   └── style.css      # All styles (no external CSS framework)
└── views/
    ├── _header.ejs    # Navbar + <head>
    ├── _footer.ejs    # Closing tags
    ├── login.ejs      # Magic link request form
    ├── dashboard.ejs  # Ticket list
    ├── ticket.ejs     # Ticket detail + reply
    └── create.ejs     # New ticket form
```

---

## License

MIT
