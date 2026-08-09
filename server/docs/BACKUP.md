# Backup & Restore — عيادة كادينا

## Backup

From `server/`:

```bash
npm run backup
```

Creates files under `server/backups/`:

1. **Preferred:** `pg_dump` plain SQL (`*.sql`) when `pg_dump` is on PATH.
2. **Fallback:** JSON export of key tables (`*.json`) when `pg_dump` is unavailable.
3. **Uploads:** copies `uploads/` into `backups/uploads-<timestamp>/`.

### JSON fallback coverage (v2)

Includes: Users, WhatsAppChannel, Contacts, Conversations, Messages, Tags, Notes,
Appointments, Templates, ContactLists, Campaigns, CampaignRecipients, Flows,
FlowSteps, FlowExecutions, TimelineEvents, ScheduledJobs, ClinicSettings,
AuditLogs, LoginHistory, WebhookSubscriptions, AiAgentSettings,
KnowledgeDocuments, KnowledgeChunks, SystemErrors, DeadLetterMessages.

### Secrets policy

| Format | Secrets |
|--------|---------|
| **JSON fallback** | `WhatsAppChannel.accessToken`, `User.passwordHash`, `ClinicSettings` WA tokens, `WebhookSubscription.secret` are stored as `[REDACTED]`. Console logs never print tokens. |
| **pg_dump SQL** | Contains **full** secrets. Treat as confidential; store off-box encrypted. |

After JSON restore, re-enter WhatsApp channel access tokens via **Admin → أرقام واتساب** (Test Connection).

Schedule daily via OS Task Scheduler / cron:

```bash
cd /path/to/server && npm run backup
```

## Restore (SQL dump)

```bash
# Stop the app first
psql "$DATABASE_URL" < backups/<file>.sql
# Restore media
xcopy /E /I backups\uploads-<timestamp> uploads
```

## Restore (JSON fallback)

```bash
node scripts/restore-json.js backups/<file>.json
```

Then set channel tokens in the Admin UI.

## Production checklist

- Store backups **off-box** (S3 / another disk).
- Test restore quarterly.
- Set `NODE_ENV=production` and real secrets before go-live.
- Prefer `pg_dump` when possible; protect the `.sql` file.
