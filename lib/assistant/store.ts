import type Anthropic from "@anthropic-ai/sdk";
import { ObjectId, type Collection } from "mongodb";
import { getDb } from "@/lib/db/mongodb";
import {
  CHAT_LIMIT,
  TITLE_MAX,
  type ChatDetail,
  type ChatPart,
  type ChatSummary,
  type ChatTurn,
} from "@/lib/assistant/shared";

// --------------------------------------------------
// ASSISTANT CHATS (MongoDB "assistantChats",
// "assistantMessages")
//
// A chat belongs to one user, and only they can open it.
// Messages are stored exactly as the API sent and took
// them (thinking blocks included) and only ever appended:
// the next request replays them unchanged, as the model
// requires. Own collections and indexes, set up here.
// --------------------------------------------------

type ChatDoc = {
  _id: ObjectId;
  userId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  // Claude usage so far, in dollars
  costUsd: number;
  // A reply is being written (one at a time per chat);
  // older than RUN_LOCK_MS counts as abandoned
  runningSince: Date | null;
};

type MessageDoc = {
  _id: ObjectId;
  chatId: ObjectId;
  role: "user" | "assistant";
  content: Anthropic.Beta.BetaContentBlockParam[];
  createdAt: Date;
  // Tool results: one line each for the page
  summaries?: Record<string, { ok: boolean; summary: string }>;
  usage?: Anthropic.Beta.BetaUsage;
  costUsd?: number;
};

export const DEFAULT_TITLE = "New chat";

// Save order: by time, then id (ids alone don't sort in
// save order across server instances)
const MESSAGE_ORDER = { createdAt: 1, _id: 1 } as const;
const RUN_LOCK_MS = 10 * 60 * 1000;

const globalForAssistant = globalThis as unknown as { assistantIndexes?: Promise<unknown> };

async function collections(): Promise<{ chats: Collection<ChatDoc>; messages: Collection<MessageDoc> }> {
  const db = await getDb();
  const chats = db.collection<ChatDoc>("assistantChats");
  const messages = db.collection<MessageDoc>("assistantMessages");

  if (!globalForAssistant.assistantIndexes) {
    globalForAssistant.assistantIndexes = Promise.all([
      chats.createIndex({ userId: 1, updatedAt: -1 }),
      messages.createIndex({ chatId: 1, createdAt: 1, _id: 1 }),
    ]).catch((error) => {
      globalForAssistant.assistantIndexes = undefined;
      throw error;
    });
  }
  await globalForAssistant.assistantIndexes;

  return { chats, messages };
}

export class ChatError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function toSummary(doc: ChatDoc): ChatSummary {
  return {
    id: doc._id.toHexString(),
    title: doc.title,
    updatedAt: doc.updatedAt.toISOString(),
    costUsd: Math.round((doc.costUsd ?? 0) * 10_000) / 10_000,
  };
}

async function ownChat(userId: string, id: string): Promise<ChatDoc> {
  if (!ObjectId.isValid(id)) throw new ChatError(404, "Chat not found");
  const { chats } = await collections();
  const doc = await chats.findOne({ _id: new ObjectId(id), userId });
  if (!doc) throw new ChatError(404, "Chat not found");
  return doc;
}

export async function listChats(userId: string): Promise<ChatSummary[]> {
  const { chats } = await collections();
  const docs = await chats.find({ userId }).sort({ updatedAt: -1 }).limit(CHAT_LIMIT).toArray();
  return docs.map(toSummary);
}

export async function createChat(userId: string): Promise<ChatSummary> {
  const { chats } = await collections();
  const now = new Date();
  const doc: ChatDoc = {
    _id: new ObjectId(),
    userId,
    title: DEFAULT_TITLE,
    createdAt: now,
    updatedAt: now,
    costUsd: 0,
    runningSince: null,
  };
  await chats.insertOne(doc);
  return toSummary(doc);
}

export async function renameChat(userId: string, id: string, title: unknown): Promise<ChatSummary> {
  const name = typeof title === "string" ? title.trim().slice(0, TITLE_MAX) : "";
  if (!name) throw new ChatError(400, "Give the chat a name");
  const chat = await ownChat(userId, id);
  const { chats } = await collections();
  await chats.updateOne({ _id: chat._id }, { $set: { title: name } });
  return toSummary({ ...chat, title: name });
}

// Returns the chat's attachment URLs, for the caller to
// delete from storage
export async function deleteChat(userId: string, id: string): Promise<string[]> {
  const chat = await ownChat(userId, id);
  const { chats, messages } = await collections();
  const docs = await messages.find({ chatId: chat._id, role: "user" }, { projection: { content: 1 } }).toArray();
  const urls = docs.flatMap((doc) =>
    doc.content.flatMap((block) =>
      (block.type === "image" || block.type === "document") && block.source.type === "url" ? [block.source.url] : [],
    ),
  );
  await messages.deleteMany({ chatId: chat._id });
  await chats.deleteOne({ _id: chat._id });
  return urls;
}

// ---------- Running a reply ----------

// One reply at a time per chat: false when one's going
export async function claimRun(userId: string, id: string): Promise<ChatDoc | null> {
  const chat = await ownChat(userId, id);
  const { chats } = await collections();
  const stale = new Date(Date.now() - RUN_LOCK_MS);
  const claimed = await chats.findOneAndUpdate(
    { _id: chat._id, $or: [{ runningSince: null }, { runningSince: { $lt: stale } }] },
    { $set: { runningSince: new Date() } },
    { returnDocument: "after" },
  );
  return claimed;
}

export async function releaseRun(chatId: ObjectId): Promise<void> {
  const { chats } = await collections();
  await chats.updateOne({ _id: chatId }, { $set: { runningSince: null, updatedAt: new Date() } });
}

// The conversation as the API takes it. A reply cut off
// after asking for tools (closed tab, crash) gets error
// results for them, so the history stays valid.
export async function loadHistory(chatId: ObjectId): Promise<Anthropic.Beta.BetaMessageParam[]> {
  const { messages } = await collections();
  const docs = await messages.find({ chatId }).sort(MESSAGE_ORDER).toArray();

  const last = docs[docs.length - 1];
  if (last?.role === "assistant") {
    const pending = last.content.filter((block): block is Anthropic.Beta.BetaToolUseBlockParam => block.type === "tool_use");
    if (pending.length) {
      const repair: MessageDoc = {
        _id: new ObjectId(),
        chatId,
        role: "user",
        content: pending.map((block) => ({
          type: "tool_result",
          tool_use_id: block.id,
          is_error: true,
          content: "Interrupted before it ran",
        })),
        summaries: Object.fromEntries(pending.map((block) => [block.id, { ok: false, summary: "Interrupted" }])),
        createdAt: new Date(),
      };
      await messages.insertOne(repair);
      docs.push(repair);
    }
  }

  return docs.map((doc) => ({ role: doc.role, content: doc.content }));
}

export async function appendMessage(
  chatId: ObjectId,
  message: Omit<MessageDoc, "_id" | "chatId" | "createdAt">,
): Promise<void> {
  const { chats, messages } = await collections();
  await messages.insertOne({ _id: new ObjectId(), chatId, createdAt: new Date(), ...message });
  await chats.updateOne(
    { _id: chatId },
    { $set: { updatedAt: new Date() }, ...(message.costUsd ? { $inc: { costUsd: message.costUsd } } : {}) },
  );
}

// Named after its first message
export async function titleFromPrompt(chatId: ObjectId, prompt: string): Promise<string | null> {
  const { chats } = await collections();
  const title = prompt.replace(/\s+/g, " ").trim().slice(0, 60) || DEFAULT_TITLE;
  const result = await chats.updateOne({ _id: chatId, title: DEFAULT_TITLE }, { $set: { title } });
  return result.modifiedCount ? title : null;
}

export async function chatSummary(chatId: ObjectId): Promise<ChatSummary | null> {
  const { chats } = await collections();
  const doc = await chats.findOne({ _id: chatId });
  return doc ? toSummary(doc) : null;
}

// ---------- Reading a chat back ----------

const attachmentName = (url: string) => decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "file");

const blockText = (content: Anthropic.Beta.BetaContentBlockParam[]) =>
  content
    .filter((block): block is Anthropic.Beta.BetaTextBlockParam => block.type === "text")
    .map((block) => block.text)
    .join("\n");

// The page's view: a user's words, then everything
// Claude did for them (thinking, tool activity, text) as
// one turn, with each tool's result beside its call
export async function getChat(userId: string, id: string): Promise<ChatDetail> {
  const chat = await ownChat(userId, id);
  const { messages } = await collections();
  const docs = await messages.find({ chatId: chat._id }).sort(MESSAGE_ORDER).toArray();

  const turns: ChatTurn[] = [];
  const tools = new Map<string, Extract<ChatPart, { kind: "tool" }>>();

  for (const doc of docs) {
    if (doc.role === "user") {
      for (const [toolId, result] of Object.entries(doc.summaries ?? {})) {
        const part = tools.get(toolId);
        if (part) part.result = result;
      }
      const parts: ChatPart[] = [];
      for (const block of doc.content) {
        if (block.type === "image" && block.source.type === "url") {
          parts.push({ kind: "attachment", type: "image", url: block.source.url, name: attachmentName(block.source.url) });
        } else if (block.type === "document" && block.source.type === "url") {
          parts.push({ kind: "attachment", type: "pdf", url: block.source.url, name: block.title ?? attachmentName(block.source.url) });
        }
      }
      const text = blockText(doc.content);
      if (text) parts.push({ kind: "user", text });
      if (parts.length) turns.push({ role: "user", parts, createdAt: doc.createdAt.toISOString() });
      continue;
    }

    let turn = turns[turns.length - 1];
    if (!turn || turn.role !== "assistant") {
      turn = { role: "assistant", parts: [], createdAt: doc.createdAt.toISOString() };
      turns.push(turn);
    }
    for (const block of doc.content) {
      if (block.type === "text" && block.text) turn.parts.push({ kind: "text", text: block.text });
      else if (block.type === "thinking" && block.thinking) turn.parts.push({ kind: "thinking", text: block.thinking });
      else if (block.type === "tool_use") {
        const part: Extract<ChatPart, { kind: "tool" }> = { kind: "tool", id: block.id, name: block.name, input: block.input };
        tools.set(block.id, part);
        turn.parts.push(part);
      }
    }
  }

  return { ...toSummary(chat), turns };
}
