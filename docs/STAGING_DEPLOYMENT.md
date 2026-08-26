# Kadina — Staging / Demo Deployment Guide

Manual steps to publish a **Staging Demo** for the client.

Architecture:

- **Frontend** → Vercel (`client/`)
- **Backend** (Express + Socket.IO + Webhook) → Railway (`server/`)
- **Database** → Neon PostgreSQL (**separate Staging DB only**)

Do **not** use Production database or Production WhatsApp credentials.

---

## Prerequisites

- GitHub account
- Neon account
- Railway account
- Vercel account
- Meta Developer app with a **WhatsApp test / sandbox** number (not Production)

---

## STEP 1 — Create Git repository (local)

This project may not be a Git repo yet. From the project root, run:

```bash
git init
git add .
git status
```

Confirm `.env` files are **not** staged. Then:

```bash
git commit -m "Prepare Kadina for Staging deployment"
```

---

## STEP 2 — Push to GitHub

1. Create an empty private GitHub repository (e.g. `kadina-staging`).
2. Push:

```bash
git remote add origin https://github.com/<YOU>/<REPO>.git
git branch -M main
git push -u origin main
```

Never commit real secrets.

---

## STEP 3 — Create Neon Staging Database

1. Neon → New Project (name it clearly: `kadina-staging`).
2. Create a **new** database (not Production).
3. Copy the connection string (`DATABASE_URL`).

Use a pooled or direct URL as Neon documents for Prisma. Prefer the connection string that works with Prisma `migrate deploy`.

---

## STEP 4 — Note DATABASE_URL

Keep `DATABASE_URL` only in:

- Neon dashboard
- Railway variables

Do not put it in Git, README, or chat logs.

---

## STEP 5 — Create Railway service

1. Railway → New Project → Deploy from GitHub.
2. Select this repository.
3. Set **Root Directory / Working Directory** to: `server`
4. Railway should detect Node automatically.

---

## STEP 6 — Railway environment variables

Set in Railway (values from your Staging secrets manager — never commit them):

### Required

| Variable | Notes |
|----------|--------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Neon Staging URL only |
| `JWT_SECRET` | Long random string (≥16 chars, not the local default) |
| `CLIENT_ORIGIN` | Temporary placeholder until Vercel URL exists, then update |
| `PUBLIC_BASE_URL` | Railway public HTTPS URL (set after first deploy if needed) |
| `DEFAULT_ADMIN_EMAIL` | e.g. `admin@kadina.demo` |
| `DEFAULT_ADMIN_PASSWORD` | Strong password (**not** `admin123`) |

### WhatsApp (Staging / test only)

| Variable | Notes |
|----------|--------|
| `WHATSAPP_ACCESS_TOKEN` | Test token |
| `WHATSAPP_PHONE_NUMBER_ID` | Test Phone Number ID |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Test WABA ID |
| `WHATSAPP_VERIFY_TOKEN` | Same value you will enter in Meta webhook |
| `WHATSAPP_APP_SECRET` | Meta App Secret (required when `NODE_ENV=production`) |
| `ALLOW_INSECURE_WEBHOOK` | `false` or unset |

### Optional

| Variable | Notes |
|----------|--------|
| `ANTHROPIC_API_KEY` | AI agent / flow auto-replies |
| `ANTHROPIC_MODEL` | Optional model override |
| `OPENAI_API_KEY` | Only if embeddings use OpenAI |
| `MEDIA_STORAGE_PATH` | Default `./uploads` |
| `BROADCAST_BATCH_SIZE` | Optional |
| `BROADCAST_BATCH_DELAY_MS` | Optional |
| `PORT` | Usually set by Railway automatically |

---

## STEP 7 — Railway build / start

| Setting | Value |
|---------|--------|
| Working directory | `server` |
| Build command | `npm run build` |
| Start command | `npm start` |
| Health check path (if available) | `/health` |

Notes:

- `npm install` / `npm ci` runs `postinstall` → `prisma generate`
- `npm run build` runs `tsc` → `dist/`
- `npm start` runs `node dist/index.js`
- Server listens on `0.0.0.0` and `process.env.PORT`
- Socket.IO and Meta webhook share the same HTTP service
- With `NODE_ENV=production`, boot refuses localhost/`*` for `CLIENT_ORIGIN` and non-HTTPS/localhost for `PUBLIC_BASE_URL`

Recommended install + build (Railway):

```bash
npm ci && npm run build
```

---

## STEP 8 — Run migrations on Staging DB

From Railway shell / one-off command **against Staging DATABASE_URL only**:

```bash
npx prisma migrate deploy
```

Or via npm script:

```bash
npm run prisma:deploy
```

**Do not** run:

- `prisma migrate reset`
- `prisma db push`

on Staging if `migrate deploy` is sufficient.

On first boot, `bootstrapApp()` creates the Admin user from `DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_PASSWORD` if missing.

---

## STEP 9 — Railway public URL

Copy the public HTTPS URL, for example:

`https://xxxxx.up.railway.app`

Set / update:

```text
PUBLIC_BASE_URL=https://xxxxx.up.railway.app
```

Verify:

```text
GET https://xxxxx.up.railway.app/health
```

Expect JSON with `ok` / `db` — no secrets.

---

## STEP 10 — Create Vercel project (Frontend)

1. Vercel → New Project → import the same GitHub repo.
2. **Root Directory:** `client`
3. Framework: Vite
4. Build command: `npm run build`
5. Output directory: `dist`
6. Environment variables (Production / Preview as needed):

```text
VITE_API_URL=https://xxxxx.up.railway.app
VITE_SOCKET_URL=https://xxxxx.up.railway.app
```

No trailing slash.

`client/vercel.json` rewrites SPA routes to `index.html`.

Redeploy after setting env vars (Vite inlines them at **build** time).

---

## STEP 11 — Set CLIENT_ORIGIN from Vercel URL

After Vercel gives you a URL, e.g. `https://xxxxx.vercel.app`:

On Railway update:

```text
CLIENT_ORIGIN=https://xxxxx.vercel.app
PUBLIC_BASE_URL=https://xxxxx.up.railway.app
```

Exact origin match (scheme + host). No `*`.

---

## STEP 12 — Redeploy Railway

Redeploy Backend so CORS + Socket.IO CORS pick up the real `CLIENT_ORIGIN`.

---

## STEP 13 — Health check

Open:

```text
https://xxxxx.up.railway.app/health
```

Then (as Admin, with Bearer token):

```text
GET /health/detailed
```

WhatsApp readiness requires at least one **active** channel with status **CONNECTED** (not merely “channel row exists”).

---

## STEP 14 — Open Frontend

Open the Vercel URL. Login page should load and call the Railway API.

---

## STEP 15 — Admin login

Use Staging Admin credentials from Railway env (`DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_PASSWORD`).

Do not share Production passwords. Do not commit credentials.

---

## STEP 16 — Create Agent from the UI

1. Admin → Settings → Team users (or Users admin UI).
2. Create an Agent with a strong password.
3. Log in as Agent in a private window.
4. Confirm Assignment visibility: Agent sees only assigned conversations.

No seed script is used for Agent creation.

---

## WhatsApp Staging (Meta)

Use a **test / sandbox** WhatsApp number — not Production.

### What you need from Meta

| Item | Where |
|------|--------|
| WhatsApp test number | Meta WhatsApp → API Setup / test numbers |
| Phone Number ID | API Setup |
| WABA ID (Business Account ID) | Business / WhatsApp account |
| Access Token | Temporary or system-user test token |
| Verify Token | You choose; must match `WHATSAPP_VERIFY_TOKEN` |
| App Secret | App Dashboard → Settings → Basic |

### Webhook

```text
Callback URL: https://RAILWAY_DOMAIN/webhook
Verify token:  (same as WHATSAPP_VERIFY_TOKEN)
```

Subscribe to messages / message_status as required by your Meta app.

### After webhook + tokens

1. Admin → WhatsApp Channels
2. Ensure channel has test Phone Number ID + Access Token
3. **Test Connection** → status must become `CONNECTED`
4. Manual tests only (no automatic sends during deploy):
   - Inbound message → Inbox + Socket
   - Outbound reply
   - Assignment / Agent reply
   - Timeline + Audit
   - Multi-channel routing if more than one channel is configured

---

## Media / uploads (Staging limitation)

- Default driver is **local** filesystem under `MEDIA_STORAGE_PATH` (default `./uploads`).
- Railway disks are ephemeral: files can be lost on redeploy. P0.2 added pluggable
  `MEDIA_STORAGE_DRIVER=auto|local|s3` plus optional S3-compatible ENV
  (`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, …).
- Leave S3 unset on Staging until you intentionally switch; existing `/uploads/...`
  message URLs keep working via signed `/media/...` routes.
- Access is via **signed** `/media/:filename` URLs (not public static browsing).
- Railway filesystem may be **ephemeral**: files can disappear after redeploy/restart.
- For Staging Demo this loss is **accepted**.
- Signed Media architecture stays as-is (P1 — do not change now). No S3 in this phase.

---

## Demo data policy

- No automatic fake patient seed.
- No real patient data.
- Use clearly fake names/numbers if you create demo conversations manually (e.g. “Demo Customer”).

---

## Security checklist (quick)

- [ ] `.env` never committed
- [ ] Staging Neon ≠ Production DB
- [ ] Staging WhatsApp ≠ Production number
- [ ] `JWT_SECRET` strong and unique to Staging
- [ ] `WHATSAPP_APP_SECRET` set; `ALLOW_INSECURE_WEBHOOK=false`
- [ ] `CLIENT_ORIGIN` exact Vercel URL (not `*`)
- [ ] `PUBLIC_BASE_URL` / `VITE_*` use HTTPS Railway URL
- [ ] Security P0 behavior unchanged

---

## Client access (after everything works)

Give the client:

1. **Frontend URL** (Vercel)
2. **Admin demo login** (out-of-band, not in Git)
3. **Agent demo login** (out-of-band, not in Git)
4. Optional: short note that WhatsApp demo uses a test number

Do **not** share:

- `JWT_SECRET`
- Meta App Secret
- Access tokens
- Database URL
