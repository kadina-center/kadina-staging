# WhatsApp Inbox — نظام إدارة واتساب لرقم واحد

مشروع كامل (Backend + Frontend) لإدارة صندوق وارد واتساب عبر Meta WhatsApp Cloud API، مع تحديث فوري عبر Socket.io.

> القيم الحساسة (توكن Meta، قاعدة البيانات) تُعبَّأ لاحقًا في ملفات `.env`. لا توجد بيانات حقيقية في المستودع.

## المتطلبات

- Node.js 18+
- PostgreSQL

## الهيكل

```
wati/
├── server/   # Express + Prisma + Socket.io
└── client/   # React + Vite + Tailwind
```

## الإعداد

### 1) Backend

```bash
cd server
cp .env.example .env
npm install
```

عدّل `server/.env` وعبّئ:

- `DATABASE_URL`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_BUSINESS_ACCOUNT_ID`
- `WHATSAPP_VERIFY_TOKEN`
- `CLIENT_ORIGIN` (افتراضيًا `http://localhost:5173`)
- `MEDIA_STORAGE_PATH` (افتراضيًا `./uploads`)
- `PUBLIC_BASE_URL` (لروابط الوسائط، افتراضيًا `http://localhost:4000`)
- `BROADCAST_BATCH_SIZE` (افتراضيًا `20`)
- `BROADCAST_BATCH_DELAY_MS` (افتراضيًا `5000`)
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL` (اختياري)
- `EMBEDDING_PROVIDER=local` (أو `openai` مع `OPENAI_API_KEY`)

ثم نفّذ الهجرات:

```bash
npx prisma migrate dev
# أو لهجرة المرحلة 2 تحديدًا بعد وجود جداول المرحلة 1:
# npx prisma migrate dev --name add-team-inbox
```

تشغيل السيرفر:

```bash
npm run dev
```

السيرفر يعمل على `http://localhost:4000` افتراضيًا.

### 2) Frontend

```bash
cd client
cp .env.example .env
npm install
npm run dev
```

الواجهة تعمل على `http://localhost:5173`.

تأكد أن `VITE_API_URL` و`VITE_SOCKET_URL` يشيران إلى عنوان السيرفر.

## الـ API

| Method | Path | الوصف |
|--------|------|--------|
| GET | `/webhook` | تحقق Meta webhook |
| POST | `/webhook` | استقبال الرسائل وحالات التسليم |
| GET | `/contacts` | قائمة جهات الاتصال |
| GET | `/contacts/:id/messages` | رسائل جهة اتصال |
| POST | `/messages` | إرسال رسالة نصية للعميل عبر واتساب |
| POST | `/messages/media` | إرسال وسائط (`multipart`: file + contactId + caption) |
| POST | `/messages/template` | إرسال قالب معتمد `{ contactId, templateId, params }` |
| GET/POST | `/templates` | قائمة/إنشاء قوالب (تُرسل لميتا للموافقة) |
| POST | `/templates/:id/sync-status` | مزامنة حالة القالب من ميتا |
| GET/POST | `/contact-lists` | قوائم/شرائح جهات الاتصال |
| POST | `/contact-lists/:id/members` | إضافة أعضاء `{ contactIds }` |
| POST | `/contact-lists/:id/import` | استيراد CSV |
| GET/POST | `/campaigns` | قائمة/إنشاء حملات جماعية |
| GET | `/campaigns/:id` | تقرير حملة + المستلمون |
| POST | `/campaigns/:id/send` | بدء إرسال على دفعات (rate-limited) |
| GET/POST | `/flows` | قائمة/إنشاء تدفقات الروبوت |
| PATCH | `/flows/:id` | تحديث/تفعيل تدفق |
| POST | `/flows/:id/steps` | إضافة خطوة |
| DELETE | `/flows/:id/steps/:stepId` | حذف خطوة |
| PATCH | `/flows/:id/steps/reorder` | إعادة ترتيب الخطوات |
| POST | `/flows/stop` | إيقاف تدفق نشط لجهة اتصال |
| GET | `/flows/active/:contactId` | حالة التدفق النشط |
| GET/POST/DELETE | `/knowledge` | قاعدة المعرفة (RAG) |
| GET/PATCH | `/ai-settings` | إعدادات الوكيل الآلي |
| GET | `/analytics/overview` | ملخص التحليلات (`?from=&to=`) |
| GET | `/analytics/campaigns/:id` | أداء حملة واحدة |
| GET | `/analytics/export` | تصدير CSV للمحادثات |
| GET | `/conversations` | محادثات الفريق (`?status=&assignedToId=&tag=`) |
| PATCH | `/conversations/:id/status` | تحديث الحالة |
| PATCH | `/conversations/:id/assign` | تعيين موظف `{ userId }` |
| POST | `/conversations/:id/tags` | ربط وسم |
| DELETE | `/conversations/:id/tags/:tagId` | إزالة وسم |
| GET/POST | `/conversations/:id/notes` | ملاحظات داخلية فقط (لا واتساب) |
| GET/POST | `/users` | قائمة/إنشاء موظفين (بدون auth بعد) |
| GET/POST | `/tags` | قائمة/إنشاء وسوم |
| GET | `/health` | فحص الصحة |

## Socket.io

- `new_message` — رسالة واردة أو صادرة جديدة
- `message_status` — تحديث حالة رسالة (sent / delivered / read / failed)
- `conversation_updated` — تحديث محادثة (حالة/تعيين/وسوم/آخر رسالة)
- `note_added` — ملاحظة داخلية جديدة
- `campaign_progress` — تقدم الحملة الجماعية لكل مستلم

## Webhook على Meta

1. اضبط Callback URL إلى: `https://YOUR_PUBLIC_URL/webhook`
2. Verify Token = قيمة `WHATSAPP_VERIFY_TOKEN` في `.env`
3. اشترك في حقل `messages`

## ملاحظات

- الكود جاهز للبناء حتى قبل تعبئة بيانات Meta.
- تحذير يظهر في الـ console إن بقيت قيم `REPLACE_ME`.
- دعم RTL مفعّل على الواجهة (`dir="rtl"`).

## Typecheck

```bash
cd server && npm run typecheck
cd client && npm run typecheck
```
