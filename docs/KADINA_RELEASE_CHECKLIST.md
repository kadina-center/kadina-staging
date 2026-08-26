# Kadina — Release Checklist

Use this checklist before calling Staging (or a later Production cut) **ready**.  
Check items only after **manual** verification. Do not commit real secrets into this file.

**Related:** `docs/STAGING_DEPLOYMENT.md`, `docs/KADINA_WATI_GAP_REPORT.md`, P0.0 baseline script `server/scripts/p0-baseline-check.js`.

---

## DATABASE

- [ ] `npx prisma migrate deploy` run successfully against the target DB
- [ ] Migrations up to date (including `20260824190000_message_edited_at`)
- [ ] `editedAt` column present / verified on `Message`
- [ ] No use of `prisma migrate reset` or destructive `db push` on shared Staging/Prod
- [ ] Admin user boots / can log in (`DEFAULT_ADMIN_*`)

---

## WHATSAPP

- [ ] Permanent **System User** token (not short-lived Graph Explorer) stored in Kadina channel
- [ ] Token **persistence** verified: restart does **not** overwrite DB token from ENV (`fb136f8` behavior)
- [ ] Channel status **CONNECTED** (Test Connection)
- [ ] Meta webhook callback URL points to Railway `/webhook`
- [ ] Webhook **verify** challenge succeeds (`WHATSAPP_VERIFY_TOKEN`)
- [ ] Webhook **HMAC** verification enabled (`WHATSAPP_APP_SECRET`; `ALLOW_INSECURE_WEBHOOK=false`)
- [ ] Inbound customer message appears in Inbox + realtime
- [ ] Outbound agent reply delivers
- [ ] Delivery status updates
- [ ] Read status updates (when provided by Meta)
- [ ] Failed message surfaces error path
- [ ] Media inbound + outbound
- [ ] Interactive **buttons**
- [ ] Interactive **list**

---

## INBOX

- [ ] Assignment (admin → agent) + agent visibility rules
- [ ] Archive / unarchive
- [ ] Lock / unlock conversation
- [ ] Tags (add/remove + filter)
- [ ] Pin message
- [ ] Star message
- [ ] Search
- [ ] Filters (incl. pin/star/tag as shipped in P0.1)
- [ ] Soft-delete / edit remain **inbox-local** (not on customer phone)

---

## CAMPAIGNS

- [ ] Contact list create / populate
- [ ] Template available and **approved** for send
- [ ] Campaign create + optional scheduling
- [ ] Delivery tracking / recipient statuses / report

---

## CRM

- [ ] Contacts visible from inbox / profile
- [ ] Timeline events
- [ ] Appointments create/list (basic)

---

## AUTOMATION

- [ ] Flows create + activate
- [ ] Wait step survives process restart (`ScheduledJob`)
- [ ] Persistent scheduled jobs runner running with API process

---

## AI

- [ ] Knowledge base document ingested
- [ ] AI agent settings configured (key present if enabling)
- [ ] Human handoff behavior verified for your prompts/keywords
- [ ] Confirm Copilot is **not** expected (removed by product decision)

---

## MEDIA

- [ ] Local provider works without S3 ENV (default / `MEDIA_STORAGE_DRIVER=auto`)
- [ ] Signed `/media/...` URLs load in Inbox
- [ ] S3-compatible configuration **documented** (see Staging guide); leave unset until intentionally enabled
- [ ] Operators understand Railway **local disk is ephemeral**

---

## SECURITY

- [ ] RBAC: admin vs agent
- [ ] Webhook HMAC required in production mode
- [ ] Rate limits active on sensitive routes
- [ ] Upload MIME + size validation
- [ ] Idempotency / duplicate webhook handling acceptable for Staging
- [ ] Audit logs recording key actions
- [ ] No secrets in Git / client bundle

---

## INFRASTRUCTURE

- [ ] Railway API `GET /health` healthy
- [ ] Vercel frontend loads and talks to `VITE_API_URL`
- [ ] Environment variables verified (see Staging guide; no placeholders in prod)
- [ ] **Restart test:** redeploy/restart Railway → channel still CONNECTED with same DB token
- [ ] `CLIENT_ORIGIN` exact Vercel origin; `PUBLIC_BASE_URL` HTTPS Railway URL
- [ ] CORS / Socket.IO still work after restart

---

## Sign-off

| Role | Name | Date | Notes |
|------|------|------|-------|
| Engineering | | | |
| Staging owner | | | |

**Do not proceed to Production WhatsApp number until WhatsApp + Security + Infrastructure sections are fully checked.**
