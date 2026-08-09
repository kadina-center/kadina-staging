import Anthropic from "@anthropic-ai/sdk";
import axios from "axios";
import type { KnowledgeChunk, Message } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";

/**
 * AI layer: RAG knowledge retrieval + Claude replies.
 *
 * Embedding notes:
 * - Default "local" provider uses deterministic hashed bag-of-words vectors
 *   (good enough for small FAQ corpora without extra API keys).
 * - Set EMBEDDING_PROVIDER=openai + OPENAI_API_KEY for real embeddings.
 * - When pgvector is available in Postgres, store vectors there and replace
 *   the in-memory cosine scan in retrieveRelevantChunks.
 */

const EMBED_DIM = 384;
const DEFAULT_SYSTEM_PROMPT =
  "أنت مساعد دعم عملاء محترف. أجب فقط من سياق قاعدة المعرفة المرفق. إن لم تجد إجابة واضحة، قل إنك ستحوّل المحادثة لموظف.";

export type RetrievedChunk = KnowledgeChunk & { score: number };

export type AiReplyResult = {
  reply: string;
  confidence: number;
  shouldHandoff: boolean;
  reason?: string;
};

function assertAnthropicKey(): string {
  const key = env.ANTHROPIC_API_KEY;
  if (!key || key === "REPLACE_ME") {
    throw new Error(
      "ANTHROPIC_API_KEY is not configured. Set it in server/.env"
    );
  }
  return key;
}

function getAnthropic(): Anthropic {
  return new Anthropic({ apiKey: assertAnthropicKey() });
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function hashToken(token: string): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % EMBED_DIM;
}

/** Local deterministic embedding — swappable via EMBEDDING_PROVIDER */
function localEmbedding(text: string): number[] {
  const vec = new Array<number>(EMBED_DIM).fill(0);
  const tokens = tokenize(text);
  if (tokens.length === 0) return vec;

  for (const token of tokens) {
    vec[hashToken(token)] += 1;
  }

  // L2 normalize for cosine similarity
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}

async function openaiEmbedding(text: string): Promise<number[]> {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY required when EMBEDDING_PROVIDER=openai");
  }
  const { data } = await axios.post<{
    data: Array<{ embedding: number[] }>;
  }>(
    "https://api.openai.com/v1/embeddings",
    { model: "text-embedding-3-small", input: text },
    {
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    }
  );
  const embedding = data.data[0]?.embedding;
  if (!embedding?.length) throw new Error("Empty embedding from OpenAI");
  return embedding;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  if (env.EMBEDDING_PROVIDER === "openai") {
    return openaiEmbedding(text);
  }
  return localEmbedding(text);
}

export function embeddingToBytes(vector: number[]): Buffer {
  const arr = Float32Array.from(vector);
  return Buffer.from(arr.buffer);
}

export function bytesToEmbedding(buf: Buffer): number[] {
  const copy = Buffer.from(buf);
  const arr = new Float32Array(
    copy.buffer,
    copy.byteOffset,
    Math.floor(copy.byteLength / 4)
  );
  return Array.from(arr);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** Split content into ~400-word chunks with ~50-word overlap */
export function chunkText(content: string): string[] {
  const words = content.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const size = 400;
  const overlap = 50;
  const chunks: string[] = [];

  if (words.length <= size) {
    return [words.join(" ")];
  }

  for (let i = 0; i < words.length; i += size - overlap) {
    const slice = words.slice(i, i + size);
    if (slice.length === 0) break;
    chunks.push(slice.join(" "));
    if (i + size >= words.length) break;
  }
  return chunks;
}

export async function getOrCreateAiSettings() {
  const existing = await prisma.aiAgentSettings.findFirst();
  if (existing) return existing;
  return prisma.aiAgentSettings.create({
    data: {
      isActive: false,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      confidenceThreshold: 0.7,
      handoffKeywords: "موظف,انسان,تحدث مع شخص,human,agent",
    },
  });
}

export async function ingestDocument(
  title: string,
  content: string
): Promise<{ documentId: string; chunkCount: number }> {
  const document = await prisma.knowledgeDocument.create({
    data: { title, content },
  });

  const parts = chunkText(content);
  for (const part of parts) {
    const vector = await generateEmbedding(part);
    await prisma.knowledgeChunk.create({
      data: {
        documentId: document.id,
        content: part,
        embedding: embeddingToBytes(vector),
      },
    });
  }

  return { documentId: document.id, chunkCount: parts.length };
}

export async function retrieveRelevantChunks(
  query: string,
  topK = 3
): Promise<{ chunks: RetrievedChunk[]; topScore: number }> {
  const queryVec = await generateEmbedding(query);
  const all = await prisma.knowledgeChunk.findMany();

  const scored: RetrievedChunk[] = all.map((chunk) => ({
    ...chunk,
    score: cosineSimilarity(queryVec, bytesToEmbedding(Buffer.from(chunk.embedding))),
  }));

  scored.sort((a, b) => b.score - a.score);
  const chunks = scored.slice(0, topK);
  const topScore = chunks[0]?.score ?? 0;
  return { chunks, topScore };
}

function containsHandoffKeyword(
  text: string,
  keywordsCsv: string
): boolean {
  const normalized = text.toLowerCase();
  const keywords = keywordsCsv
    .split(/[,،]/)
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
  return keywords.some((k) => normalized.includes(k));
}

export async function generateAiReply(
  customerMessage: string,
  conversationHistory: Message[]
): Promise<AiReplyResult> {
  const settings = await getOrCreateAiSettings();

  if (containsHandoffKeyword(customerMessage, settings.handoffKeywords)) {
    return {
      reply: "",
      confidence: 0,
      shouldHandoff: true,
      reason: "handoff_keyword",
    };
  }

  const { chunks, topScore } = await retrieveRelevantChunks(customerMessage, 3);

  // Strict confidence gate — do not call the model when retrieval is weak
  if (topScore < settings.confidenceThreshold) {
    return {
      reply: "",
      confidence: topScore,
      shouldHandoff: true,
      reason: "low_confidence",
    };
  }

  const knowledgeContext = chunks
    .map((c, i) => `[مقطع ${i + 1} | تشابه ${c.score.toFixed(2)}]\n${c.content}`)
    .join("\n\n");

  const history = conversationHistory
    .slice(-10)
    .map((m) => `${m.direction === "inbound" ? "العميل" : "الوكيل"}: ${m.content}`)
    .join("\n");

  const client = getAnthropic();
  const response = await client.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 600,
    system: `${settings.systemPrompt}

قواعد صارمة:
- أجب بالعربية الفصحى الواضحة إلا إذا كتب العميل بغيرها.
- استخدم فقط معلومات قاعدة المعرفة أدناه.
- إن كانت المعرفة غير كافية للإجابة بثقة، اكتب بالضبط: HANDOFF
- لا تخمّن أسعارًا أو سياسات غير موجودة في السياق.`,
    messages: [
      {
        role: "user",
        content: `قاعدة المعرفة:
${knowledgeContext || "(فارغة)"}

سجل المحادثة الأخير:
${history || "(لا يوجد)"}

سؤال العميل:
${customerMessage}`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const reply = textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";

  if (!reply || /^HANDOFF\b/i.test(reply) || reply.includes("HANDOFF")) {
    return {
      reply: "",
      confidence: topScore,
      shouldHandoff: true,
      reason: "model_handoff",
    };
  }

  return {
    reply,
    confidence: topScore,
    shouldHandoff: false,
  };
}

/**
 * Copilot only — never sends to WhatsApp. Returns 2–3 draft suggestions.
 */
export async function generateCopilotSuggestions(
  conversationHistory: Message[]
): Promise<string[]> {
  if (conversationHistory.length === 0) {
    return [
      "مرحبًا، كيف يمكنني مساعدتك اليوم؟",
      "شكرًا لتواصلك معنا، سأراجع طلبك الآن.",
    ];
  }

  const history = conversationHistory
    .slice(-10)
    .map((m) => `${m.direction === "inbound" ? "العميل" : "الموظف"}: ${m.content}`)
    .join("\n");

  let knowledgeHint = "";
  const lastInbound = [...conversationHistory]
    .reverse()
    .find((m) => m.direction === "inbound");
  if (lastInbound) {
    const { chunks, topScore } = await retrieveRelevantChunks(
      lastInbound.content,
      2
    );
    if (topScore >= 0.35 && chunks.length) {
      knowledgeHint = chunks.map((c) => c.content).join("\n---\n");
    }
  }

  try {
    const client = getAnthropic();
    const response = await client.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 500,
      system:
        "أنت مساعد لموظف خدمة عملاء. اقترح 3 ردود قصيرة جاهزة للإرسال. أعد الناتج كـ JSON array من سلاسل نصية فقط بدون شرح.",
      messages: [
        {
          role: "user",
          content: `سجل المحادثة:
${history}

${knowledgeHint ? `مقتطفات معرفة قد تفيد:\n${knowledgeHint}` : ""}

أرجع JSON array من 2 أو 3 اقتراحات.`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const raw = textBlock && textBlock.type === "text" ? textBlock.text.trim() : "[]";
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return fallbackSuggestions(lastInbound?.content);
    const parsed = JSON.parse(jsonMatch[0]) as unknown;
    if (!Array.isArray(parsed)) return fallbackSuggestions(lastInbound?.content);
    return parsed
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .slice(0, 3);
  } catch (error) {
    console.error("[ai] copilot suggestions error:", error);
    return fallbackSuggestions(lastInbound?.content);
  }
}

function fallbackSuggestions(lastMessage?: string): string[] {
  return [
    "شكرًا لرسالتك، سأتحقق من الأمر وأعود إليك فورًا.",
    lastMessage
      ? `بخصوص استفسارك، هل يمكنك تزويدي بمزيد من التفاصيل؟`
      : "مرحبًا، كيف يمكنني مساعدتك؟",
    "تم استلام رسالتك وسأحوّلها للقسم المختص إن لزم الأمر.",
  ];
}
