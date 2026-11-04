import type http from "http";

// --------------------------------------------------
// FAKE ANTHROPIC MESSAGES API (/anthropic/v1/messages)
//
// Streams replies in the real server-sent-event shape, so
// the app's assistant runs end to end with no real calls
// and no cost. What it does is steered by the last user
// message:
//   [tool:NAME {json}]  asks for that tool (several ok)
//   [refuse]            stop_reason "refusal"
//   [badkey]            401 authentication_error
//   [slow]              takes ~4 s (to test busy chats)
//   anything else       "You said: …" (and which files
//                       were attached)
// After tool results come back it answers with what the
// first one said.
// --------------------------------------------------

export const FAKE_ANTHROPIC_KEY = "fake-anthropic-key";

type Block = Record<string, unknown>;
type Message = { role: string; content: string | Block[] };

export type AnthropicRequest = { headers: http.IncomingHttpHeaders; body: Record<string, unknown> };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function lastUser(messages: Message[]): Block[] {
  // Consecutive user messages count as one turn
  const blocks: Block[] = [];
  for (let i = messages.length - 1; i >= 0 && messages[i].role === "user"; i--) {
    const content = messages[i].content;
    blocks.unshift(...(typeof content === "string" ? [{ type: "text", text: content }] : content));
  }
  return blocks;
}

export async function handleFakeAnthropic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  path: string,
  body: unknown,
  requests: AnthropicRequest[],
): Promise<void> {
  const json = (status: number, data: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(data));
  };

  if (path !== "/anthropic/v1/messages" || req.method !== "POST") {
    return json(404, { type: "error", error: { type: "not_found_error", message: `No fake for ${path}` } });
  }
  // The SDK sends the key either way, by version
  const key = req.headers["x-api-key"] ?? req.headers.authorization?.replace(/^Bearer /, "");
  if (key !== FAKE_ANTHROPIC_KEY) {
    return json(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
  }

  const request = (body ?? {}) as Record<string, unknown>;
  requests.push({ headers: req.headers, body: request });
  const turn = lastUser((request.messages as Message[]) ?? []);
  const said = turn
    .filter((block) => block.type === "text")
    .map((block) => String(block.text))
    .join(" ");
  const toolResults = turn.filter((block) => block.type === "tool_result");

  if (said.includes("[badkey]")) {
    return json(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
  }

  // What to answer
  const blocks: Block[] = [{ type: "thinking", thinking: "Considering the request.", signature: "fake-signature" }];
  let stopReason = "end_turn";
  if (toolResults.length) {
    const first = toolResults[0].content;
    const text = typeof first === "string" ? first : JSON.stringify(first);
    blocks.push({ type: "text", text: `Here's what I found: ${text.slice(0, 300)}` });
  } else if (said.includes("[refuse]")) {
    blocks.length = 0;
    stopReason = "refusal";
  } else {
    const calls = [...said.matchAll(/\[tool:([a-z_]+)(\s+\{[^\]]*\})?\]/g)];
    if (calls.length) {
      blocks.push({ type: "text", text: "Let me check." });
      calls.forEach((call, index) => {
        blocks.push({ type: "tool_use", id: `toolu_fake_${Date.now()}_${index}`, name: call[1], input: JSON.parse(call[2]?.trim() || "{}") });
      });
      stopReason = "tool_use";
    } else {
      const files = turn.filter((block) => block.type === "image" || block.type === "document");
      const seen = files.length ? ` (with ${files.map((block) => (block.type === "image" ? "an image" : "a PDF")).join(" and ")})` : "";
      blocks.push({ type: "text", text: `You said: ${said}${seen}` });
    }
  }

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const emit = (type: string, data: Record<string, unknown>) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  const slow = said.includes("[slow]");

  emit("message_start", {
    message: {
      id: `msg_fake_${Date.now()}`,
      type: "message",
      role: "assistant",
      model: String(request.model),
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1000, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 500 },
    },
  });

  for (const [index, block] of blocks.entries()) {
    if (block.type === "thinking") {
      emit("content_block_start", { index, content_block: { type: "thinking", thinking: "", signature: "" } });
      emit("content_block_delta", { index, delta: { type: "thinking_delta", thinking: block.thinking } });
      emit("content_block_delta", { index, delta: { type: "signature_delta", signature: block.signature } });
    } else if (block.type === "text") {
      emit("content_block_start", { index, content_block: { type: "text", text: "" } });
      // A few pieces, like a real stream
      const text = String(block.text);
      const step = Math.max(1, Math.ceil(text.length / 3));
      for (let at = 0; at < text.length; at += step) {
        if (slow) await sleep(1300);
        emit("content_block_delta", { index, delta: { type: "text_delta", text: text.slice(at, at + step) } });
      }
    } else {
      emit("content_block_start", { index, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } });
      emit("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } });
    }
    emit("content_block_stop", { index });
  }

  emit("message_delta", { delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 200 } });
  emit("message_stop", {});
  res.end();
}
