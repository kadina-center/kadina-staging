export const API_URL =
  import.meta.env.VITE_API_URL || "http://localhost:4000";

export const TOKEN_KEY = "kadina_token";
const USER_KEY = "kadina_user";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export type Contact = {
  id: string;
  phone: string;
  name: string | null;
  channel?: string;
  channelUserId?: string | null;
  crmStatus?: string;
  customNotes?: string | null;
  avatarUrl?: string | null;
  doctor?: string | null;
  treatment?: string | null;
  visitCount?: number;
  leadSource?: string | null;
  lastAppointmentAt?: string | null;
  lastAgentId?: string | null;
  lastAgent?: {
    id: string;
    name: string;
    email: string;
    role: string;
  } | null;
  optedOut?: boolean;
  lastMessageAt: string;
  createdAt: string;
  lastMessage?: {
    id: string;
    content: string;
    direction: string;
    createdAt: string;
    status: string;
    createdByUserId?: string | null;
    createdByName?: string | null;
    createdByRole?: string | null;
    createdByAvatar?: string | null;
    senderType?: string | null;
    senderName?: string | null;
    senderRole?: string | null;
    senderAvatar?: string | null;
    sentByAi?: boolean;
  } | null;
};

/** ADMIN | AGENT | AI | SYSTEM | AUTOMATION | BOT */
export type SenderType =
  | "ADMIN"
  | "AGENT"
  | "AI"
  | "SYSTEM"
  | "AUTOMATION"
  | "BOT"
  | string;

export type Message = {
  id: string;
  contactId: string;
  direction: "inbound" | "outbound" | string;
  type: string;
  content: string;
  status: string;
  waMessageId: string | null;
  mediaUrl?: string | null;
  mediaMimeType?: string | null;
  caption?: string | null;
  sentByAi?: boolean;
  createdByUserId?: string | null;
  createdByName?: string | null;
  createdByRole?: string | null;
  createdByAvatar?: string | null;
  senderType?: SenderType | null;
  senderUserId?: string | null;
  senderName?: string | null;
  senderRole?: string | null;
  senderAvatar?: string | null;
  replyToMessageId?: string | null;
  replyToWaMessageId?: string | null;
  metaPayload?: string | null;
  errorMessage?: string | null;
  deletedAt?: string | null;
  createdAt: string;
};

export function normalizeSenderType(
  value?: string | null,
  sentByAi?: boolean
): SenderType | null {
  if (!value) return sentByAi ? "BOT" : null;
  const upper = value.trim().toUpperCase();
  if (
    ["ADMIN", "AGENT", "AI", "SYSTEM", "AUTOMATION", "BOT"].includes(upper)
  ) {
    return upper;
  }
  return sentByAi ? "BOT" : null;
}

export function messageAvatar(message: Message): string | null {
  return message.createdByAvatar || message.senderAvatar || null;
}

export function messageSenderName(message: Message): string {
  return (
    message.senderName?.trim() ||
    message.createdByName?.trim() ||
    ""
  );
}

/** Conversation list preview: "Ahmed: …" / "🤖 AI: …" */
export function formatMessagePreview(
  message: {
    content?: string | null;
    direction?: string | null;
    createdByName?: string | null;
    senderName?: string | null;
    senderType?: string | null;
    sentByAi?: boolean;
  } | null | undefined,
  fallback = ""
): string {
  if (!message) return fallback;
  const body = (message.content || "").replace(/\s+/g, " ").trim();
  const clipped = body.length > 80 ? `${body.slice(0, 79)}…` : body;
  if (message.direction !== "outbound") return clipped || fallback;

  const type = normalizeSenderType(message.senderType, message.sentByAi);
  const name =
    message.senderName?.trim() || message.createdByName?.trim() || "";

  if (type === "AI") return `🤖 ${name || "AI"}: ${clipped}`;
  if (type === "AUTOMATION") return `⚙ ${name || "أتمتة"}: ${clipped}`;
  if (type === "BOT") return `🤖 ${name || "بوت"}: ${clipped}`;
  if (type === "SYSTEM") return `⚙ ${name || "نظام"}: ${clipped}`;
  if (name) return `${name}: ${clipped}`;
  return clipped || fallback;
}

export function senderLabel(message: Message): string {
  const type = normalizeSenderType(message.senderType, message.sentByAi);
  const name = messageSenderName(message);
  if (type === "AI") return name || "AI";
  if (type === "AUTOMATION") return name || "أتمتة";
  if (type === "BOT") return name || "بوت";
  if (type === "SYSTEM") return name || "نظام";
  if (name) return name;
  if (message.sentByAi) return "بوت";
  return "موظف";
}

const GROUP_GAP_MS = 15 * 60 * 1000;

/** Intercom/WATI style: show name when sender changes or gap > 15 min */
export function shouldShowOutboundSender(
  messages: Message[],
  index: number
): boolean {
  const message = messages[index];
  if (!message || message.direction !== "outbound") return false;
  if (
    !messageSenderName(message) &&
    !message.senderType &&
    !message.sentByAi
  ) {
    return false;
  }
  const prev = messages[index - 1];
  if (!prev || prev.direction !== "outbound") return true;

  const key = (m: Message) =>
    `${m.createdByUserId || m.senderUserId || ""}|${messageSenderName(m)}|${normalizeSenderType(m.senderType, m.sentByAi) || ""}`;
  if (key(prev) !== key(message)) return true;

  const gap =
    new Date(message.createdAt).getTime() - new Date(prev.createdAt).getTime();
  return gap > GROUP_GAP_MS;
}

export function formatReplyTime(value: string): string {
  const d = new Date(value);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString("ar-SA", {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (sameDay) return `اليوم ${time}`;
  return (
    d.toLocaleDateString("ar-SA", {
      day: "numeric",
      month: "short",
    }) +
    ` ${time}`
  );
}

export type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
};

export type Tag = {
  id: string;
  name: string;
  color: string;
};

export type WhatsAppChannelSummary = {
  id: string;
  name: string;
  displayName: string;
  phoneNumber: string;
  status: string;
  isActive: boolean;
};

export type WhatsAppChannel = WhatsAppChannelSummary & {
  phoneNumberId: string;
  businessAccountId: string | null;
  assignedUserId: string | null;
  lastWebhookAt: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { conversations: number };
};

export type WhatsAppChannelTestResult = {
  status: "CONNECTED" | "ERROR";
  message: string;
};

export type Conversation = {
  id: string;
  contactId: string;
  status: "open" | "pending" | "closed" | string;
  assignedToId: string | null;
  assignedAt?: string | null;
  assignedByUserId?: string | null;
  assignedBy?: User | null;
  lastMessageAt: string;
  createdAt: string;
  pinned?: boolean;
  archived?: boolean;
  unreadCount?: number;
  lastReadAt?: string | null;
  lockedById?: string | null;
  lockedAt?: string | null;
  lockedBy?: User | null;
  channelId?: string | null;
  channel?: {
    id: string;
    name: string;
    displayName: string;
    phoneNumber: string;
  } | null;
  contact: Contact;
  assignedTo: User | null;
  tags: Tag[];
};

export type Note = {
  id: string;
  conversationId: string;
  authorId: string;
  content: string;
  createdAt: string;
  updatedAt?: string;
  author: Pick<User, "id" | "name" | "email" | "role">;
};

export type Template = {
  id: string;
  name: string;
  category: string;
  language: string;
  bodyText: string;
  status: "pending" | "approved" | "rejected" | string;
  metaTemplateId: string | null;
  createdAt: string;
  warning?: string;
};

export type ConversationFilters = {
  status?: string;
  assignedToId?: string;
  tag?: string;
  channel?: string;
  channelId?: string;
  search?: string;
  pinned?: string;
  archived?: string;
};

export function mediaSrc(mediaUrl?: string | null): string | null {
  if (!mediaUrl) return null;
  if (mediaUrl.startsWith("http://") || mediaUrl.startsWith("https://")) {
    return mediaUrl;
  }
  // Legacy /uploads paths are no longer public — prefer server-signed /media URLs.
  if (mediaUrl.startsWith("/media/")) {
    return `${API_URL.replace(/\/$/, "")}${mediaUrl}`;
  }
  if (mediaUrl.startsWith("/uploads/")) {
    // Unsigned legacy path — will 404 until reloaded from API (which re-signs).
    return `${API_URL.replace(/\/$/, "")}${mediaUrl.replace(/^\/uploads\//, "/media/")}`;
  }
  return `${API_URL.replace(/\/$/, "")}${mediaUrl}`;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly messagePayload?: Message;
  readonly technicalMessage?: string;

  constructor(opts: {
    status: number;
    message: string;
    code?: string;
    messagePayload?: Message;
    technicalMessage?: string;
  }) {
    super(opts.message);
    this.name = "ApiError";
    this.status = opts.status;
    this.code = opts.code;
    this.messagePayload = opts.messagePayload;
    this.technicalMessage = opts.technicalMessage;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

function httpErrorMessage(status: number, fallback?: string): string {
  if (fallback?.trim()) return fallback.trim();
  switch (status) {
    case 400:
      return "طلب غير صالح";
    case 401:
      return "انتهت الجلسة. سجّل الدخول مرة أخرى.";
    case 403:
      return "غير مصرح بتنفيذ هذا الإجراء";
    case 404:
      return "غير موجود";
    case 409:
      return "تعارض في البيانات. حدّث الصفحة وحاول مرة أخرى.";
    case 422:
      return "بيانات غير مكتملة أو غير صالحة";
    case 429:
      return "محاولات كثيرة. حاول لاحقًا.";
    case 500:
      return "خطأ داخلي في الخادم";
    case 502:
      return "فشل الاتصال بخدمة واتساب. حاول مرة أخرى.";
    default:
      return `فشل الطلب (${status})`;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const isFormData =
    typeof FormData !== "undefined" && init?.body instanceof FormData;

  if (!isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const token = getToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers,
    });
  } catch {
    throw new ApiError({
      status: 0,
      code: "NETWORK_ERROR",
      message: `تعذر الاتصال بالسيرفر (${API_URL}). تأكد أن الـ API يعمل على المنفذ 4000.`,
    });
  }

  if (res.status === 401 && !path.startsWith("/auth/login")) {
    clearToken();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("kadina:logout"));
    }
    throw new ApiError({
      status: 401,
      message: "انتهت الجلسة. سجّل الدخول مرة أخرى.",
    });
  }

  if (!res.ok) {
    let message = httpErrorMessage(res.status);
    let code: string | undefined;
    let messagePayload: Message | undefined;
    let technicalMessage: string | undefined;
    try {
      const body = (await res.json()) as {
        error?: string;
        code?: string;
        message?: Message;
        technicalMessage?: string;
      };
      message = httpErrorMessage(res.status, body.error);
      code = body.code;
      if (body.message && typeof body.message === "object" && body.message.id) {
        messagePayload = body.message;
      }
      technicalMessage = body.technicalMessage;
    } catch {
      // ignore JSON parse errors
    }
    throw new ApiError({
      status: res.status,
      message,
      code,
      messagePayload,
      technicalMessage,
    });
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export function login(
  email: string,
  password: string
): Promise<{ token: string; user: User }> {
  return request<{ token: string; user: User }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function getMe(): Promise<User> {
  return request<User>("/auth/me");
}

export function logoutApi(): Promise<void> {
  return request<void>("/auth/logout", { method: "POST" });
}

export function getDetailedHealth(): Promise<DetailedHealth> {
  return request<DetailedHealth>("/health/detailed");
}

export type HealthWhatsAppChannel = {
  id: string;
  name: string;
  displayName: string;
  status: string;
  isActive: boolean;
  lastWebhookAt: string | null;
  lastMessageAt: string | null;
};

export type DetailedHealth = {
  ok: boolean;
  overall?: "healthy" | "degraded" | "unhealthy";
  messagingReady?: boolean;
  db: string;
  timestamp: string;
  whatsapp?: {
    configured: boolean;
    channelCount?: number;
    activeCount?: number;
    connectedCount?: number;
  };
  whatsappChannels?: HealthWhatsAppChannel[];
  webhook?: { lastInboundAt: string | null };
  socket?: { connectedCount: number | null };
  queue?: { pending: number; failed: number };
  messages?: { pendingFailed: number };
  deadLetterMessages?: number;
  systemErrorsLast24h?: number;
  lastError?: {
    id: string;
    source: string;
    message: string;
    createdAt: string;
  } | null;
  lastBackup?: { name: string; mtime: string } | null;
  lastAuditLog?: {
    id: string;
    action: string;
    actorId: string | null;
    createdAt: string;
  } | null;
};

export function getContacts(): Promise<Contact[]> {
  return request<Contact[]>("/contacts");
}

export type Paginated<T> = {
  items: T[];
  nextCursor: string | null;
};

export function getMessages(
  contactId: string,
  opts?: { cursor?: string; limit?: number }
): Promise<Message[] | Paginated<Message>> {
  const params = new URLSearchParams();
  const limit = opts?.limit ?? 100;
  params.set("limit", String(limit));
  if (opts?.cursor) params.set("cursor", opts.cursor);
  return request<Message[] | Paginated<Message>>(
    `/contacts/${contactId}/messages?${params.toString()}`
  );
}

export async function getMessagesPage(
  contactId: string,
  opts?: { cursor?: string; limit?: number }
): Promise<Paginated<Message>> {
  const data = await getMessages(contactId, opts);
  if (Array.isArray(data)) {
    return { items: data, nextCursor: null };
  }
  return data;
}

export function sendMessage(
  contactId: string,
  text: string,
  replyToMessageId?: string
): Promise<Message> {
  return request<Message>("/messages", {
    method: "POST",
    body: JSON.stringify({
      contactId,
      text,
      ...(replyToMessageId ? { replyToMessageId } : {}),
    }),
  });
}

export function retryMessage(messageId: string): Promise<Message> {
  return request<Message>(`/messages/${messageId}/retry`, {
    method: "POST",
  });
}

export function sendInteractiveButtons(
  contactId: string,
  bodyText: string,
  buttons: Array<{ id: string; title: string }>
): Promise<Message> {
  return request<Message>("/messages/interactive", {
    method: "POST",
    body: JSON.stringify({
      contactId,
      interactiveType: "buttons",
      bodyText,
      buttons,
    }),
  });
}

export function updateContact(
  id: string,
  data: {
    name?: string | null;
    crmStatus?: string;
    customNotes?: string | null;
    doctor?: string | null;
    treatment?: string | null;
    leadSource?: string | null;
    visitCount?: number;
    lastAgentId?: string | null;
  }
): Promise<Contact> {
  return request<Contact>(`/contacts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export type ContactProfile = {
  contact: Contact;
  conversation: {
    id: string;
    status: string;
    assignedToId: string | null;
    assignedTo: User | null;
    assignedAt?: string | null;
    assignedByUserId?: string | null;
    assignedBy?: User | null;
    pinned: boolean;
    archived: boolean;
    unreadCount: number;
    lastMessageAt: string;
    createdAt: string;
    tags: Tag[];
    noteCount: number;
  } | null;
  lastMessage: {
    id: string;
    content: string;
    direction: string;
    type: string;
    status: string;
    createdAt: string;
    createdByName?: string | null;
    createdByRole?: string | null;
    senderType?: string | null;
  } | null;
  lastRepliedBy: {
    userId: string | null;
    name: string | null;
    role: string | null;
    senderType: string | null;
    avatar: string | null;
    at: string;
  } | null;
  counts: {
    conversations: number;
    messages: number;
    media: number;
    appointments: number;
    appointmentsScheduled: number;
    notes: number;
    visits: number;
  };
  tags: Tag[];
};

export function getContactProfile(id: string): Promise<ContactProfile> {
  return request(`/contacts/${id}/profile`);
}

export type ContactMediaItem = {
  id: string;
  messageId: string;
  type: string;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  caption: string | null;
  content: string;
  direction: string;
  createdAt: string;
  createdByName?: string | null;
  createdByRole?: string | null;
  senderType?: string | null;
  senderName?: string | null;
};

export function getContactMedia(
  id: string,
  params?: { cursor?: string; limit?: number }
): Promise<{ items: ContactMediaItem[]; nextCursor: string | null }> {
  const qs = new URLSearchParams();
  if (params?.cursor) qs.set("cursor", params.cursor);
  if (params?.limit) qs.set("limit", String(params.limit));
  const q = qs.toString();
  return request(`/contacts/${id}/media${q ? `?${q}` : ""}`);
}

export type Appointment = {
  id: string;
  contactId: string;
  agentId: string | null;
  title: string;
  notes: string | null;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  contact?: Pick<Contact, "id" | "name" | "phone" | "channel">;
  agent?: Pick<User, "id" | "name" | "email"> | null;
};

export function listAppointments(params?: {
  contactId?: string;
  status?: string;
  cursor?: string;
  limit?: number;
}): Promise<Appointment[] | { items: Appointment[]; nextCursor: string | null }> {
  const qs = new URLSearchParams();
  if (params?.contactId) qs.set("contactId", params.contactId);
  if (params?.status) qs.set("status", params.status);
  if (params?.cursor) qs.set("cursor", params.cursor);
  if (params?.limit) qs.set("limit", String(params.limit));
  const q = qs.toString();
  return request(`/appointments${q ? `?${q}` : ""}`);
}

export function createAppointment(data: {
  contactId: string;
  title: string;
  scheduledAt: string;
  durationMinutes?: number;
  notes?: string | null;
  agentId?: string | null;
}): Promise<Appointment> {
  return request("/appointments", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateAppointment(
  id: string,
  data: {
    title?: string;
    notes?: string | null;
    scheduledAt?: string;
    durationMinutes?: number;
    agentId?: string | null;
    status?: string;
  }
): Promise<Appointment> {
  return request(`/appointments/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export type TimelineFilter =
  | "all"
  | "messages"
  | "crm"
  | "appointments"
  | "campaigns"
  | "automation"
  | "ai"
  | "notes"
  | "system";

export type TimelineEvent = {
  id: string;
  contactId: string;
  conversationId: string | null;
  eventType: string;
  title: string;
  description: string | null;
  performedByUserId: string | null;
  performedByName: string | null;
  performedByRole: string | null;
  actorType: string;
  metadata: unknown;
  createdAt: string;
};

export type TimelinePage = {
  items: TimelineEvent[];
  nextCursor: string | null;
};

export function getContactTimeline(
  contactId: string,
  params?: {
    cursor?: string;
    limit?: number;
    search?: string;
    filter?: TimelineFilter | string;
  }
): Promise<TimelinePage> {
  const q = new URLSearchParams();
  if (params?.cursor) q.set("cursor", params.cursor);
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.search) q.set("search", params.search);
  if (params?.filter) q.set("filter", params.filter);
  const qs = q.toString();
  return request<TimelinePage>(
    `/contacts/${contactId}/timeline${qs ? `?${qs}` : ""}`
  );
}

export function sendMediaMessage(
  contactId: string,
  file: File,
  caption?: string
): Promise<Message> {
  const form = new FormData();
  form.append("contactId", contactId);
  form.append("file", file);
  if (caption?.trim()) form.append("caption", caption.trim());

  return request<Message>("/messages/media", {
    method: "POST",
    body: form,
  });
}

export function sendTemplateMessage(
  contactId: string,
  templateId: string,
  params: string[] = []
): Promise<Message> {
  return request<Message>("/messages/template", {
    method: "POST",
    body: JSON.stringify({ contactId, templateId, params }),
  });
}

export function getConversations(
  filters: ConversationFilters & { cursor?: string; limit?: number } = {}
): Promise<Conversation[] | Paginated<Conversation>> {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.assignedToId) params.set("assignedToId", filters.assignedToId);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.channel) params.set("channel", filters.channel);
  if (filters.channelId) params.set("channelId", filters.channelId);
  if (filters.search) params.set("search", filters.search);
  if (filters.pinned) params.set("pinned", filters.pinned);
  if (filters.archived) params.set("archived", filters.archived);
  params.set("limit", String(filters.limit ?? 50));
  if (filters.cursor) params.set("cursor", filters.cursor);
  const qs = params.toString();
  return request<Conversation[] | Paginated<Conversation>>(
    `/conversations${qs ? `?${qs}` : ""}`
  );
}

export async function getConversationsPage(
  filters: ConversationFilters & { cursor?: string; limit?: number } = {}
): Promise<Paginated<Conversation>> {
  const data = await getConversations(filters);
  if (Array.isArray(data)) {
    return { items: data, nextCursor: null };
  }
  return data;
}

export function markConversationRead(id: string): Promise<Conversation> {
  return request<Conversation>(`/conversations/${id}/read`, {
    method: "PATCH",
  });
}

export function pinConversation(
  id: string,
  pinned?: boolean
): Promise<Conversation> {
  return request<Conversation>(`/conversations/${id}/pin`, {
    method: "PATCH",
    body: JSON.stringify(
      typeof pinned === "boolean" ? { pinned } : {}
    ),
  });
}

export function archiveConversation(
  id: string,
  archived?: boolean
): Promise<Conversation> {
  return request<Conversation>(`/conversations/${id}/archive`, {
    method: "PATCH",
    body: JSON.stringify(
      typeof archived === "boolean" ? { archived } : {}
    ),
  });
}

export function takeOverConversation(id: string): Promise<Conversation> {
  return request<Conversation>(`/conversations/${id}/takeover`, {
    method: "POST",
  });
}

export type WebhookSubscription = {
  id: string;
  url: string;
  events: string;
  isActive: boolean;
  createdAt: string;
  secret?: string;
};

export function getWebhookSubscriptions(): Promise<WebhookSubscription[]> {
  return request<WebhookSubscription[]>("/webhook-subscriptions");
}

export function createWebhookSubscription(
  url: string,
  events: string[]
): Promise<WebhookSubscription> {
  return request<WebhookSubscription>("/webhook-subscriptions", {
    method: "POST",
    body: JSON.stringify({ url, events }),
  });
}

export function deleteWebhookSubscription(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/webhook-subscriptions/${id}`, {
    method: "DELETE",
  });
}

export function testWebhookSubscription(
  id: string
): Promise<{ ok: boolean; status: number }> {
  return request<{ ok: boolean; status: number }>(
    `/webhook-subscriptions/${id}/test`,
    { method: "POST" }
  );
}

export function exportContactsToGoogleSheet(
  spreadsheetId: string,
  accessToken: string
): Promise<{ ok: boolean; rowsWritten: number }> {
  return request<{ ok: boolean; rowsWritten: number }>(
    "/integrations/google-sheets/export",
    {
      method: "POST",
      body: JSON.stringify({ spreadsheetId, accessToken }),
    }
  );
}

export function updateConversationStatus(
  id: string,
  status: string
): Promise<Conversation> {
  return request<Conversation>(`/conversations/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export function assignConversation(
  id: string,
  userId: string | null
): Promise<Conversation> {
  return request<Conversation>(`/conversations/${id}/assign`, {
    method: "PATCH",
    body: JSON.stringify({ userId }),
  });
}

export function addConversationTag(
  id: string,
  tagId: string
): Promise<Conversation> {
  return request<Conversation>(`/conversations/${id}/tags`, {
    method: "POST",
    body: JSON.stringify({ tagId }),
  });
}

export function removeConversationTag(
  id: string,
  tagId: string
): Promise<Conversation> {
  return request<Conversation>(`/conversations/${id}/tags/${tagId}`, {
    method: "DELETE",
  });
}

export function getUsers(): Promise<User[]> {
  return request<User[]>("/users");
}

export function createUser(data: {
  name: string;
  email: string;
  password: string;
  role?: string;
}): Promise<User> {
  return request<User>("/users", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateUser(
  id: string,
  data: { name?: string; email?: string; role?: string }
): Promise<User> {
  return request<User>(`/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function changeUserPassword(
  id: string,
  password: string
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/users/${id}/password`, {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export function deleteUser(id: string): Promise<void> {
  return request<void>(`/users/${id}`, { method: "DELETE" });
}

export function getTags(): Promise<Tag[]> {
  return request<Tag[]>("/tags");
}

export function createTag(data: {
  name: string;
  color?: string;
}): Promise<Tag> {
  return request<Tag>("/tags", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateTag(
  id: string,
  data: { name?: string; color?: string }
): Promise<Tag> {
  return request<Tag>(`/tags/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteTag(id: string): Promise<void> {
  return request<void>(`/tags/${id}`, { method: "DELETE" });
}

export function getNotes(conversationId: string): Promise<Note[]> {
  return request<Note[]>(`/conversations/${conversationId}/notes`);
}

/** Internal notes only — never sent to WhatsApp */
export function createNote(
  conversationId: string,
  data: string | { authorId?: string; content: string }
): Promise<Note> {
  const body =
    typeof data === "string" ? { content: data } : data;
  return request<Note>(`/conversations/${conversationId}/notes`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateNote(
  conversationId: string,
  noteId: string,
  content: string
): Promise<Note> {
  return request<Note>(`/conversations/${conversationId}/notes/${noteId}`, {
    method: "PATCH",
    body: JSON.stringify({ content }),
  });
}

export function deleteNote(
  conversationId: string,
  noteId: string
): Promise<void> {
  return request<void>(`/conversations/${conversationId}/notes/${noteId}`, {
    method: "DELETE",
  });
}

export function getTemplates(): Promise<Template[]> {
  return request<Template[]>("/templates");
}

export function createTemplate(data: {
  name: string;
  category: string;
  language?: string;
  bodyText: string;
}): Promise<Template> {
  return request<Template>("/templates", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function syncTemplateStatus(id: string): Promise<Template> {
  return request<Template>(`/templates/${id}/sync-status`, {
    method: "POST",
  });
}

export type ContactListSummary = {
  id: string;
  name: string;
  createdAt: string;
  memberCount: number;
};

export type ContactListDetail = ContactListSummary & {
  contacts: Array<{
    id: string;
    phone: string;
    name: string | null;
    optedOut: boolean;
    createdAt: string;
  }>;
};

export type CampaignStats = {
  total: number;
  counts: Record<string, number>;
};

export type CampaignSummary = {
  id: string;
  name: string;
  status: string;
  scheduledAt: string | null;
  createdAt: string;
  channelId?: string | null;
  channel?: {
    id: string;
    name: string;
    displayName: string;
    phoneNumber: string;
  } | null;
  template: {
    id: string;
    name: string;
    status: string;
    bodyText: string;
  };
  contactList: { id: string; name: string };
  recipientCount: number;
  stats: CampaignStats;
};

export type CampaignRecipient = {
  id: string;
  campaignId: string;
  contactId: string;
  status: string;
  waMessageId: string | null;
  errorMessage: string | null;
  sentAt: string | null;
  contact: {
    id: string;
    phone: string;
    name: string | null;
    optedOut: boolean;
  };
};

export type CampaignDetail = {
  id: string;
  name: string;
  status: string;
  scheduledAt: string | null;
  createdAt: string;
  channelId?: string | null;
  channel?: {
    id: string;
    name: string;
    displayName: string;
    phoneNumber: string;
  } | null;
  template: Template;
  contactList: { id: string; name: string };
  recipients: CampaignRecipient[];
  stats: CampaignStats;
};

export type CampaignProgressEvent = {
  campaignId: string;
  status?: string;
  recipientId?: string;
  contactId?: string;
  recipientStatus?: string;
  waMessageId?: string;
  error?: string;
  total?: number;
  processed?: number;
  counts?: Record<string, number>;
};

export function getContactLists(): Promise<ContactListSummary[]> {
  return request<ContactListSummary[]>("/contact-lists");
}

export function createContactList(name: string): Promise<ContactListSummary> {
  return request<ContactListSummary>("/contact-lists", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function getContactList(id: string): Promise<ContactListDetail> {
  return request<ContactListDetail>(`/contact-lists/${id}`);
}

export function addContactListMembers(
  id: string,
  contactIds: string[]
): Promise<{ ok: boolean; memberCount: number }> {
  return request(`/contact-lists/${id}/members`, {
    method: "POST",
    body: JSON.stringify({ contactIds }),
  });
}

export function importContactListCsv(
  id: string,
  file: File
): Promise<{ ok: boolean; imported: number; skipped: number; memberCount: number }> {
  const form = new FormData();
  form.append("file", file);
  return request(`/contact-lists/${id}/import`, {
    method: "POST",
    body: form,
  });
}

export function getCampaigns(): Promise<CampaignSummary[]> {
  return request<CampaignSummary[]>("/campaigns");
}

export function getCampaign(id: string): Promise<CampaignDetail> {
  return request<CampaignDetail>(`/campaigns/${id}`);
}

export function createCampaign(data: {
  name: string;
  templateId: string;
  contactListId: string;
  channelId: string;
  scheduledAt?: string | null;
}): Promise<CampaignSummary> {
  return request<CampaignSummary>("/campaigns", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function sendCampaign(
  id: string
): Promise<{ ok: boolean; message: string; pending: number }> {
  return request(`/campaigns/${id}/send`, { method: "POST" });
}

export type FlowStep = {
  id: string;
  flowId: string;
  order: number;
  actionType: string;
  actionValue: string;
  createdAt: string;
};

export type Flow = {
  id: string;
  name: string;
  isActive: boolean;
  triggerType: string;
  triggerValue: string | null;
  createdAt: string;
  steps: FlowStep[];
};

export type ActiveFlowInfo =
  | { active: false }
  | {
      active: true;
      execution: {
        id: string;
        flowId: string;
        contactId: string;
        currentStep: number;
        status: string;
      };
      flow: { id: string; name: string } | null;
    };

export function getFlows(): Promise<Flow[]> {
  return request<Flow[]>("/flows");
}

export function getFlow(id: string): Promise<Flow> {
  return request<Flow>(`/flows/${id}`);
}

export function createFlow(data: {
  name: string;
  triggerType: string;
  triggerValue?: string | null;
  isActive?: boolean;
}): Promise<Flow> {
  return request<Flow>("/flows", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateFlow(
  id: string,
  data: Partial<{
    name: string;
    triggerType: string;
    triggerValue: string | null;
    isActive: boolean;
  }>
): Promise<Flow> {
  return request<Flow>(`/flows/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function addFlowStep(
  flowId: string,
  data: { order?: number; actionType: string; actionValue: string }
): Promise<FlowStep> {
  return request<FlowStep>(`/flows/${flowId}/steps`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function deleteFlowStep(
  flowId: string,
  stepId: string
): Promise<{ ok: boolean }> {
  return request(`/flows/${flowId}/steps/${stepId}`, { method: "DELETE" });
}

export function reorderFlowSteps(
  flowId: string,
  stepIds: string[]
): Promise<FlowStep[]> {
  return request(`/flows/${flowId}/steps/reorder`, {
    method: "PATCH",
    body: JSON.stringify({ stepIds }),
  });
}

export function stopContactFlow(contactId: string): Promise<{ ok: boolean }> {
  return request("/flows/stop", {
    method: "POST",
    body: JSON.stringify({ contactId }),
  });
}

export function getActiveFlow(contactId: string): Promise<ActiveFlowInfo> {
  return request<ActiveFlowInfo>(`/flows/active/${contactId}`);
}

export type KnowledgeDocument = {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  chunkCount: number;
};

export type AiSettings = {
  id: string;
  isActive: boolean;
  systemPrompt: string;
  confidenceThreshold: number;
  handoffKeywords: string;
};

export function getKnowledgeDocuments(): Promise<KnowledgeDocument[]> {
  return request<KnowledgeDocument[]>("/knowledge");
}

export function createKnowledgeDocument(data: {
  title: string;
  content: string;
}): Promise<KnowledgeDocument> {
  return request<KnowledgeDocument>("/knowledge", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function deleteKnowledgeDocument(
  id: string
): Promise<{ ok: boolean }> {
  return request(`/knowledge/${id}`, { method: "DELETE" });
}

export function getAiSettings(): Promise<AiSettings> {
  return request<AiSettings>("/ai-settings");
}

export function updateAiSettings(
  data: Partial<{
    isActive: boolean;
    systemPrompt: string;
    confidenceThreshold: number;
    handoffKeywords: string;
  }>
): Promise<AiSettings> {
  return request<AiSettings>("/ai-settings", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

/** Copilot only — never sends a WhatsApp message */
export function getCopilotSuggestions(data: {
  conversationId?: string;
  contactId?: string;
}): Promise<{ suggestions: string[] }> {
  return request("/ai/copilot-suggestions", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export type AnalyticsOverview = {
  range: { from: string; to: string };
  kpis: {
    totalConversations: number;
    currentlyOpen: number;
    averageResponseMinutes: number | null;
    aiOutboundRatio: number;
  };
  conversations: {
    statusCounts: {
      open: number;
      pending: number;
      closed: number;
      total: number;
    };
    currentlyOpen: number;
    newConversationsDaily: Array<{ date: string; count: number }>;
  };
  responseTime: {
    averageMinutes: number | null;
    sampleSize: number;
    byAgent: Array<{
      userId: string;
      name: string;
      averageMinutes: number | null;
      sampleSize: number;
    }>;
  };
  messageVolume: {
    daily: Array<{ date: string; inbound: number; outbound: number }>;
    totals: {
      inbound: number;
      outbound: number;
      outboundHuman: number;
      outboundAi: number;
      aiOutboundRatio: number;
    };
  };
  team: Array<{
    userId: string;
    name: string;
    email: string;
    conversationsHandled: number;
    conversationsClosed: number;
    averageResponseMinutes: number | null;
  }>;
  campaigns: CampaignAnalytics[];
  tags: Array<{ id: string; name: string; color: string; count: number }>;
};

export type CampaignAnalytics = {
  id: string;
  name: string;
  status: string;
  template: { id: string; name: string };
  total: number;
  counts: Record<string, number>;
  deliveryRate: number;
  readRate: number;
  failureRate: number;
  topFailureReasons: Array<{ reason: string; count: number }>;
};

export function getAnalyticsOverview(params?: {
  from?: string;
  to?: string;
}): Promise<AnalyticsOverview> {
  const qs = new URLSearchParams();
  if (params?.from) qs.set("from", params.from);
  if (params?.to) qs.set("to", params.to);
  const query = qs.toString();
  return request<AnalyticsOverview>(
    `/analytics/overview${query ? `?${query}` : ""}`
  );
}

export function getCampaignAnalytics(
  id: string
): Promise<CampaignAnalytics> {
  return request<CampaignAnalytics>(`/analytics/campaigns/${id}`);
}

export async function exportAnalyticsCsv(params?: {
  from?: string;
  to?: string;
}): Promise<Blob> {
  const qs = new URLSearchParams();
  if (params?.from) qs.set("from", params.from);
  if (params?.to) qs.set("to", params.to);
  const query = qs.toString();
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(
    `${API_URL}/analytics/export${query ? `?${query}` : ""}`,
    { headers }
  );
  if (res.status === 401) {
    clearToken();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("kadina:logout"));
    }
    throw new Error("انتهت الجلسة. سجّل الدخول مرة أخرى.");
  }
  if (!res.ok) {
    throw new Error(`فشل التصدير (${res.status})`);
  }
  return res.blob();
}

export type ClinicSettings = {
  clinicName: string;
  timezone: string;
  language: string;
  businessHoursJson: string;
  welcomeMessage: string;
  awayMessage: string;
  welcomeEnabled: boolean;
  awayEnabled: boolean;
  whatsapp: {
    accessTokenMasked: string | null;
    phoneNumberId: string | null;
    businessAccountId: string | null;
    verifyTokenMasked: string | null;
    usingEnvFallback: boolean;
  };
  updatedAt: string;
};

export function getSettings(): Promise<ClinicSettings> {
  return request<ClinicSettings>("/settings");
}

export function updateClinicSettings(data: {
  clinicName?: string;
  timezone?: string;
  language?: string;
  businessHoursJson?: string;
  welcomeMessage?: string;
  awayMessage?: string;
  welcomeEnabled?: boolean;
  awayEnabled?: boolean;
}): Promise<{
  clinicName: string;
  timezone: string;
  language: string;
  businessHoursJson: string;
  welcomeMessage: string;
  awayMessage: string;
  welcomeEnabled: boolean;
  awayEnabled: boolean;
}> {
  return request("/settings/clinic", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function getWhatsAppChannels(): Promise<WhatsAppChannel[]> {
  return request<WhatsAppChannel[]>("/whatsapp/channels");
}

export function getWhatsAppChannel(id: string): Promise<WhatsAppChannel> {
  return request<WhatsAppChannel>(`/whatsapp/channels/${id}`);
}

export function getWhatsAppChannelsPublic(): Promise<
  WhatsAppChannelSummary[]
> {
  return request<WhatsAppChannelSummary[]>("/whatsapp/channels/public");
}

export function createWhatsAppChannel(data: {
  name: string;
  displayName: string;
  phoneNumber: string;
  phoneNumberId: string;
  accessToken: string;
  businessAccountId?: string | null;
  isActive?: boolean;
}): Promise<WhatsAppChannel> {
  return request<WhatsAppChannel>("/whatsapp/channels", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateWhatsAppChannel(
  id: string,
  data: {
    name?: string;
    displayName?: string;
    phoneNumber?: string;
    phoneNumberId?: string;
    accessToken?: string;
    businessAccountId?: string | null;
    isActive?: boolean;
  }
): Promise<WhatsAppChannel> {
  return request<WhatsAppChannel>(`/whatsapp/channels/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteWhatsAppChannel(id: string): Promise<void> {
  return request<void>(`/whatsapp/channels/${id}`, { method: "DELETE" });
}

export function testWhatsAppChannel(
  id: string
): Promise<WhatsAppChannelTestResult> {
  return request<WhatsAppChannelTestResult>(
    `/whatsapp/channels/${id}/test`,
    { method: "POST" }
  );
}

export function activateWhatsAppChannel(id: string): Promise<WhatsAppChannel> {
  return request<WhatsAppChannel>(`/whatsapp/channels/${id}/activate`, {
    method: "POST",
  });
}

export function deactivateWhatsAppChannel(
  id: string
): Promise<WhatsAppChannel> {
  return request<WhatsAppChannel>(`/whatsapp/channels/${id}/deactivate`, {
    method: "POST",
  });
}

export function updateWhatsAppSettings(data: {
  whatsappAccessToken?: string | null;
  whatsappPhoneNumberId?: string | null;
  whatsappBusinessAccountId?: string | null;
  whatsappVerifyToken?: string | null;
}): Promise<{
  ok: boolean;
  whatsappAccessToken: string | null;
  whatsappPhoneNumberId: string | null;
  whatsappBusinessAccountId: string | null;
  whatsappVerifyToken: string | null;
}> {
  return request("/settings/whatsapp", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export type AuditLogEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  performedByUserId: string | null;
  performedByName: string | null;
  performedByRole: string | null;
  actorType: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  status: string;
  oldValues: unknown;
  newValues: unknown;
  metadata: unknown;
  createdAt: string;
};

export type AuditStats = {
  totalToday: number;
  errors: number;
  warnings: number;
  logins: number;
  messagesSent: number;
};

export type AuditPage = {
  items: AuditLogEntry[];
  nextCursor: string | null;
};

export function getAuditPage(params?: {
  cursor?: string;
  limit?: number;
  search?: string;
  action?: string;
  entityType?: string;
  userId?: string;
  status?: string;
  from?: string;
  to?: string;
}): Promise<AuditPage> {
  const qs = new URLSearchParams();
  if (params?.cursor) qs.set("cursor", params.cursor);
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.search) qs.set("search", params.search);
  if (params?.action) qs.set("action", params.action);
  if (params?.entityType) qs.set("entityType", params.entityType);
  if (params?.userId) qs.set("userId", params.userId);
  if (params?.status) qs.set("status", params.status);
  if (params?.from) qs.set("from", params.from);
  if (params?.to) qs.set("to", params.to);
  const query = qs.toString();
  return request(`/audit${query ? `?${query}` : ""}`);
}

export function getAuditStats(): Promise<AuditStats> {
  return request("/audit/stats");
}

export async function exportAudit(params?: {
  search?: string;
  action?: string;
  entityType?: string;
  userId?: string;
  status?: string;
  from?: string;
  to?: string;
  format?: "csv" | "json";
}): Promise<void> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set("search", params.search);
  if (params?.action) qs.set("action", params.action);
  if (params?.entityType) qs.set("entityType", params.entityType);
  if (params?.userId) qs.set("userId", params.userId);
  if (params?.status) qs.set("status", params.status);
  if (params?.from) qs.set("from", params.from);
  if (params?.to) qs.set("to", params.to);
  qs.set("format", params?.format || "json");
  const token = getToken();
  const res = await fetch(`${API_URL}/audit/export?${qs.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new Error("فشل تصدير سجل التدقيق");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download =
    params?.format === "csv" ? "audit-export.csv" : "audit-export.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
