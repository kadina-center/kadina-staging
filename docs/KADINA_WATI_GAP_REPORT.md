# Kadina ↔ WATI Gap Report

**As of:** P0.2 (`89b2def`) + P0.3 docs  
**Scope:** Honest status of Kadina staging vs a WATI-like clinic WhatsApp SaaS.  
**Legend**

| Status | Meaning |
|--------|---------|
| **GREEN** | Implemented end-to-end enough for Staging demos; production-usable with known limits |
| **YELLOW** | Backend and/or UI exists, but incomplete, fragile, or not production-ready |
| **RED** | Missing or not usable |
| **DEFERRED** | Intentionally postponed (product decision) |

Related baseline: **P0.0** staging check, **P0.1** inbox UI, **P0.2** media storage abstraction.

---

## Summary matrix

| Area | Status |
|------|--------|
| WhatsApp Core | GREEN |
| Team Inbox | GREEN |
| Contacts | YELLOW |
| Campaigns | YELLOW |
| CRM | YELLOW |
| Flows | YELLOW |
| Automation | YELLOW |
| Appointments | YELLOW |
| AI | YELLOW |
| Knowledge Base | YELLOW |
| Templates | YELLOW |
| Media | YELLOW |
| Analytics | YELLOW |
| Clinic Features | YELLOW |
| Security | GREEN |
| Integrations | YELLOW |
| Omnichannel | RED |

---

## WhatsApp Core — GREEN

| | |
|--|--|
| **Current status** | Meta Cloud API path works on Staging: inbound/outbound, statuses, media, interactive buttons + lists. Token persistence fixed (`fb136f8`): ENV seeds placeholders only; DB is source of truth. |
| **Backend** | Channel adapter, webhook (HMAC), send text/media/template/interactive, multi-channel `WhatsAppChannel`, Test Connection → `CONNECTED`. |
| **Frontend** | WhatsApp Channels admin page; Inbox composer (text, media, buttons, list). |
| **Database** | `WhatsAppChannel`, `Message` (`waMessageId`, status, media fields), contacts scoped by channel. |
| **Production readiness** | Staging-ready with System User token + App Secret. Not a full Meta Business portfolio product yet. |
| **Remaining work** | Production number onboarding UX; richer template sync from Meta; monitoring/alerting on token expiry. |

---

## Team Inbox — GREEN

| | |
|--|--|
| **Current status** | Full team inbox for WhatsApp: realtime Socket.IO, assignment visibility, archive, lock/unlock, tags, pin/star messages + conversation pin, search/filters (P0.1). Local edit/soft-delete (not synced to customer phone — Meta limitation). |
| **Backend** | Conversations + messages APIs; pin/star/lock/tags; soft-delete + edit; RBAC (agent sees assigned). |
| **Frontend** | Inbox, chat window, conversation list filters, composer interactive list (P0.1). |
| **Database** | `Conversation`, `Message` (`pinned`, `starred`, `deletedAt`, `editedAt`), tags M2M. |
| **Production readiness** | Staging demo ready for clinic inbox workflows. |
| **Remaining work** | SLA timers, canned replies library UX polish, presence beyond basic, bulk actions. |

---

## Contacts — YELLOW

| | |
|--|--|
| **Current status** | Contacts created from inbound WhatsApp; profile/notes/timeline in UI; contact lists for campaigns. Not a full CRM contact manager. |
| **Backend** | Contacts CRUD-ish APIs, opt-out, channel scope, notes, timeline events. |
| **Frontend** | Customer profile panel, contact lists page; no standalone advanced contacts directory. |
| **Database** | `Contact`, `ContactList`, notes, timeline. |
| **Production readiness** | Enough for inbox + campaigns lists; weak as a CRM system of record. |
| **Remaining work** | Import/export UX, merge duplicates, custom fields, segmentation beyond lists. |

---

## Campaigns — YELLOW

| | |
|--|--|
| **Current status** | Campaigns with template + contact list + optional schedule + recipient tracking + report UI exist. Not fully battle-tested for large/prod sends. |
| **Backend** | Campaign create/list/get, schedule via jobs, batch send, recipient statuses. |
| **Frontend** | Campaigns list, builder, report pages. |
| **Database** | `Campaign`, `CampaignRecipient`, `ContactList`, `Template`. |
| **Production readiness** | Staging demos OK; treat as YELLOW until P1 hardening (rate limits at Meta scale, retries, pause/resume). |
| **Remaining work** | Robust scheduling/ops, failure dashboards, template variable mapping polish, compliance (opt-out enforcement audits). |

---

## CRM — YELLOW

| | |
|--|--|
| **Current status** | Light CRM beside inbox: profile, notes, timeline, appointments panel. Not Salesforce-class CRM. |
| **Backend** | Notes, timeline, appointments APIs. |
| **Frontend** | `CrmPanel`, `CustomerProfile`, `CustomerTimeline`, appointments UI embedded. |
| **Database** | Notes, timeline events, `Appointment`. |
| **Production readiness** | Useful for clinic agents on Staging; incomplete as standalone CRM product. |
| **Remaining work** | Pipelines/stages, deal/lead objects, reminders UX, reporting on CRM objects. |

---

## Flows — YELLOW

| | |
|--|--|
| **Current status** | Flow builder + engine (keyword / any_message / `no_response_24h` trigger types). Wait steps use durable `ScheduledJob`. |
| **Backend** | Flow CRUD, execution engine, job handlers. |
| **Frontend** | Flows list + Flow Builder. |
| **Database** | `Flow`, `FlowStep`, `FlowExecution`, `ScheduledJob`. |
| **Production readiness** | Demo-capable; complex clinic bots need more testing and ops tooling. |
| **Remaining work** | Harden `no_response_24h`, richer step types, versioning, analytics per flow, safer test mode. |

---

## Automation — YELLOW

| | |
|--|--|
| **Current status** | Durable scheduled jobs in Postgres (survives restart) power flow waits and campaign schedule. Not a full automation product (Zapier-like). |
| **Backend** | `scheduled-jobs.service` runner + enqueue API used by flows/campaigns. |
| **Frontend** | Indirect (flows/campaigns UI only). |
| **Database** | `ScheduledJob`. |
| **Production readiness** | Better than in-memory timers; still single-process poller (no Redis/BullMQ by design for now). |
| **Remaining work** | Admin job UI, dead-letter, multi-instance locking, more trigger types. |

---

## Appointments — YELLOW

| | |
|--|--|
| **Current status** | Appointment model + API + CRM UI. Not a full clinic booking calendar. |
| **Backend** | Appointments controller/routes. |
| **Frontend** | Embedded in customer/CRM panels. |
| **Database** | `Appointment`. |
| **Production readiness** | Basic tracking only. |
| **Remaining work** | Calendar views, reminders via WhatsApp, conflict rules, staff schedules. |

---

## AI — YELLOW

| | |
|--|--|
| **Current status** | AI agent settings + knowledge-backed replies in flows path. **Copilot inbox suggestions removed** (`b1b2728`) — DEFERRED / intentionally out. |
| **Backend** | AI settings, Anthropic integration, RAG-ish knowledge usage. |
| **Frontend** | AI Settings page (no Copilot UI). |
| **Database** | AI settings fields on clinic/settings models; knowledge tables. |
| **Production readiness** | Optional; requires `ANTHROPIC_API_KEY`. Needs careful prompt + handoff QA. |
| **Remaining work** | Stronger handoff, evaluation, cost controls; decide if Copilot returns later. |

---

## Knowledge Base — YELLOW

| | |
|--|--|
| **Current status** | Documents + chunks + admin UI; used by AI agent. Embedding provider configurable (`local` / OpenAI). |
| **Backend** | Knowledge CRUD + chunking/embeddings. |
| **Frontend** | Knowledge Base page. |
| **Database** | `KnowledgeDocument`, `KnowledgeChunk`. |
| **Production readiness** | Staging OK for small clinics; quality depends on content + embeddings. |
| **Remaining work** | Better retrieval eval, file upload types, multilingual clinic content tooling. |

---

## Templates — YELLOW

| | |
|--|--|
| **Current status** | Local template store + send template messages + campaign use. Not a full Meta template sync/approval console. |
| **Backend** | Templates API; WhatsApp template send. |
| **Frontend** | Templates page. |
| **Database** | `Template`. |
| **Production readiness** | Manual/approved templates for Staging; Meta sync incomplete. |
| **Remaining work** | Sync status from Meta, category/language management, variable validation UX. |

---

## Media — YELLOW

| | |
|--|--|
| **Current status** | **P0.2:** Pluggable storage — `LocalMediaStorageProvider` (default) + `S3CompatibleMediaStorageProvider`. Signed `/media` URLs preserved. S3 optional (no credentials required). MIME/size validation on upload; path traversal guards. |
| **Backend** | Provider abstraction; inbound store + outbound upload to Meta from buffer; serve signed media. |
| **Frontend** | Inbox media send/display via signed URLs (`mediaSrc`). |
| **Database** | `Message.mediaUrl`, `mediaMimeType` (no new columns in P0.2). |
| **Production readiness** | Local works; **Railway disk is ephemeral** → production should configure S3-compatible storage later. Abstraction is ready; live S3 not required yet. |
| **Remaining work** | Configure S3 on prod; optional media GC/delete UX; virus scanning (future). |

---

## Analytics — YELLOW

| | |
|--|--|
| **Current status** | Analytics page + campaign analytics endpoint. Not a full BI suite. |
| **Backend** | Analytics routes (incl. campaign). |
| **Frontend** | Analytics page, campaign report. |
| **Database** | Uses message/campaign fields (analytics migration fields present). |
| **Production readiness** | Directional metrics for Staging; not audited BI. |
| **Remaining work** | Funnel metrics, agent performance, export, date-range polish. |

---

## Clinic Features — YELLOW

| | |
|--|--|
| **Current status** | Clinic settings (name, WhatsApp-related clinic config), appointments, Arabic RTL inbox oriented to clinics. Not a full HIS/EMR. |
| **Backend** | Clinic settings service/API. |
| **Frontend** | Settings + CRM/appointments. |
| **Database** | `ClinicSettings`, appointments. |
| **Production readiness** | Branding/settings OK; clinical workflows incomplete. |
| **Remaining work** | Patient journey presets, department routing, consent forms, reminder campaigns. |

---

## Security — GREEN

| | |
|--|--|
| **Current status** | Auth JWT, RBAC admin/agent, webhook HMAC (required in production), rate limits, upload MIME/size checks, audit logs, assignment-scoped sockets, signed media (not public `/uploads` browse). |
| **Backend** | Auth middleware, verify-meta-signature, audit service, helmet/CORS hardening. |
| **Frontend** | Login, role-based nav, Audit Center (admin). |
| **Database** | `User`, `AuditLog`. |
| **Production readiness** | Staging hardened path is solid when ENV is correct. |
| **Remaining work** | SSO, finer permissions, secrets rotation runbooks, pen-test. |

---

## Integrations — YELLOW

| | |
|--|--|
| **Current status** | Outbound webhook subscriptions + Google Sheets export UI/API. |
| **Backend** | Webhook subscriptions, Google Sheets controller. |
| **Frontend** | Integrations page. |
| **Database** | Webhook subscription model (integrations migration). |
| **Production readiness** | Useful hooks; Sheets needs valid tokens/credentials from operator. |
| **Remaining work** | More events, retry/DLQ UI, OAuth for Google, Zapier-style catalog. |

---

## Omnichannel — RED

| | |
|--|--|
| **Current status** | Channel types exist in code (`instagram`, `messenger` adapters / ENV placeholders). **Not a production omnichannel product.** WhatsApp is the supported path. |
| **Backend** | Partial adapters; primary path is WhatsApp. |
| **Frontend** | Inbox assumes WhatsApp-first; no full IG/Messenger ops UI. |
| **Database** | `Contact.channel` supports values; WhatsApp channels table is real. |
| **Production readiness** | **Do not sell as omnichannel yet.** |
| **Remaining work** | Full IG/Messenger webhook lifecycle, unified inbox QA, Meta app setup docs per channel. |

---

## Intentionally deferred

| Item | Status | Notes |
|------|--------|-------|
| Inbox Copilot suggestions | DEFERRED | Removed; AI agent + KB kept |
| Redis/BullMQ | DEFERRED | `ScheduledJob` in Postgres for now |
| Force Meta edit/delete on customer device | DEFERRED | API limitation; local edit/delete only |
| Live S3 on Railway Staging | DEFERRED | Abstraction ready (P0.2); configure when durable media required |
| Full omnichannel | DEFERRED | After WhatsApp SaaS core (P1+) |

---

## P0 progress impact

| Phase | Effect on this report |
|-------|------------------------|
| **P0.0** | Confirmed migrations, channel CONNECTED, token persistence behavior, health, recent deliverability baseline |
| **P0.1** | Inbox → **GREEN** for lock/tags/pin/star/list composer/filters |
| **P0.2** | Media abstraction → Local default + S3-ready; Media remains **YELLOW** until durable object storage is configured for production |
| **P0.3** | This documentation + release checklist (no app logic change) |

---

## Recommended next product order (reference only — do not start in P0.3)

1. **P1** — Campaigns / CRM / automation hardening  
2. **P2** — Clinic + AI depth  
3. **P3** — Templates + analytics polish  
4. Omnichannel only after WhatsApp core is sellable
