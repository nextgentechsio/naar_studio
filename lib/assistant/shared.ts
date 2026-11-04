// --------------------------------------------------
// ASSISTANT: types and limits shared by the server
// (lib/assistant/*) and the chat page
// (app/(studio)/assistant)
// --------------------------------------------------

export const ASSISTANT_MODEL = "claude-opus-5-5";
export const ASSISTANT_MODEL_LABEL = "Claude Opus 5.5";
// What one person can type in one message
export const PROMPT_MAX = 8000;
export const TITLE_MAX = 80;
// Chats in the sidebar
export const CHAT_LIMIT = 100;

// ---------- Attachments ----------
// Images Claude can see and PDFs it can read, uploaded
// to Blob storage under the sender's own folder

export const ATTACHMENT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"];
export const MAX_ATTACHMENTS = 5;
// Claude's limits: images up to 5 MB, PDFs up to 32 MB
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_BYTES = 30 * 1024 * 1024;

export function assistantFolder(userId: string): string {
  return `assistant/${userId.replace(/[^\w-]+/g, "_")}/`;
}

export type Attachment = { url: string; type: "image" | "pdf"; name: string };

export type ChatSummary = {
  id: string;
  title: string;
  updatedAt: string;
  // What its Claude usage has cost so far
  costUsd: number;
};

// One piece of a conversation, as the page shows it
export type ChatPart =
  | { kind: "user"; text: string }
  | ({ kind: "attachment" } & Attachment)
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      input: unknown;
      // Filled when its result is in
      result?: { ok: boolean; summary: string };
    }
  | { kind: "notice"; text: string };

export type ChatTurn = {
  role: "user" | "assistant";
  parts: ChatPart[];
  createdAt: string;
};

export type ChatDetail = ChatSummary & { turns: ChatTurn[] };

// What the server streams while Claude works (one JSON
// object per server-sent event)
export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; ok: boolean; summary: string }
  | { type: "notice"; text: string }
  | { type: "done"; costUsd: number; chatCostUsd: number; title: string }
  | { type: "error"; message: string };

// Short, readable names for the tool activity rows
export const TOOL_LABELS: Record<string, string> = {
  list_projects: "Looked up projects",
  find_models: "Searched models",
  model_details: "Read model settings",
  estimate_cost: "Estimated the price",
  search_history: "Searched your history",
  list_elements: "Looked up elements",
};
