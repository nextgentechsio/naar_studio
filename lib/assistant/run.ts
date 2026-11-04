import Anthropic from "@anthropic-ai/sdk";
import type { StoredUser } from "@/lib/auth/users";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { APP_NAME } from "@/lib/app-info";
import { ASSISTANT_MODEL, PROMPT_MAX, type StreamEvent } from "@/lib/assistant/shared";
import {
  appendMessage,
  chatSummary,
  ChatError,
  claimRun,
  loadHistory,
  releaseRun,
  titleFromPrompt,
} from "@/lib/assistant/store";
import { attachmentBlocks } from "@/lib/assistant/attachments";
import { runTool, TOOL_DEFINITIONS } from "@/lib/assistant/tools";

// --------------------------------------------------
// ONE ASSISTANT REPLY
//
// Saves the user's message, then loops: stream Claude's
// answer to the page, run the tools it asks for (as the
// user, read only), feed the results back, until it's
// done. Every message is saved as it completes, so a
// closed tab loses nothing finished. One reply at a time
// per chat.
//
// Model: Claude Opus 5.5, adaptive thinking (readable
// summaries shown on the page), medium effort. Refused
// requests fall back server-side to another model.
// The tools, instructions and history are cached between
// turns (prefix caching), so long chats stay cheap.
// --------------------------------------------------

export function assistantConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// Tool rounds per reply, so a confused loop can't run on
const MAX_STEPS = 12;

// Claude Opus 5.5, $ per million tokens
const PRICE = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 };

export function usageCostUsd(usage: Anthropic.Beta.BetaUsage): number {
  const cost =
    (usage.input_tokens * PRICE.input +
      usage.output_tokens * PRICE.output +
      (usage.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite +
      (usage.cache_read_input_tokens ?? 0) * PRICE.cacheRead) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

// Fixed text (never per user or per day), so it caches
const INSTRUCTIONS = `You are the assistant inside ${APP_NAME}, a studio where a creative team generates images, videos and audio with Replicate, Higgsfield and ElevenLabs models, organised by project, with every run's cost tracked.

Help people plan and understand their work: find the right model, explain its settings, price a run before anyone spends money, find past runs and saved elements, and write strong prompts.

Use the tools to check facts instead of guessing: model ids, settings, allowed values and prices come from find_models, model_details and estimate_cost. Elements are referenced in prompts as @name.

You can't start or cancel runs from this chat yet. When someone wants to generate, give them a ready-to-use plan: platform, model, project, the exact settings, the prompt, and the estimated cost, and tell them to run it from that platform's page in the studio.

Be concise and practical. Use short paragraphs and lists; use a table to compare options. State prices in US dollars and say whether a price is exact or an estimate.`;

type Options = { user: StoredUser; chatId: string; prompt: unknown; attachments?: unknown; signal?: AbortSignal };

export async function* runAssistant({ user, chatId, prompt, attachments, signal }: Options): AsyncGenerator<StreamEvent> {
  const text = typeof prompt === "string" ? prompt.trim() : "";
  if (!text && !(Array.isArray(attachments) && attachments.length)) throw new ChatError(400, "Write a message");
  if (text.length > PROMPT_MAX) throw new ChatError(400, `Keep messages under ${PROMPT_MAX} characters`);
  if (!assistantConfigured()) throw new ChatError(503, "The assistant isn't set up yet. An admin needs to add ANTHROPIC_API_KEY.");

  // Checked before anything is saved: the files must be
  // the sender's own uploads
  const files = await attachmentBlocks(user.id, attachments);

  const chat = await claimRun(user.id, chatId);
  if (!chat) throw new ChatError(409, "A reply is still being written in this chat");

  let replyCost = 0;
  try {
    const history = await loadHistory(chat._id);
    // Files first, then the words about them
    const userMessage: Anthropic.Beta.BetaMessageParam = {
      role: "user",
      content: [...files, ...(text ? [{ type: "text" as const, text }] : [])],
    };
    await appendMessage(chat._id, { role: "user", content: userMessage.content as Anthropic.Beta.BetaContentBlockParam[] });
    history.push(userMessage);
    const title = await titleFromPrompt(chat._id, text || (files.length === 1 ? "Attachment" : `${files.length} attachments`));

    const client = new Anthropic();
    // Who's asking and today's date: changes per person
    // and day, so after the fixed (cached) instructions
    const context = `The person you're helping: ${user.name} (${ROLE_LABELS[user.role]}). Today is ${new Date().toDateString()}.`;

    let finished = false;
    for (let step = 0; step < MAX_STEPS && !signal?.aborted; step++) {
      const stream = client.beta.messages.stream(
        {
          model: ASSISTANT_MODEL,
          max_tokens: 32_000,
          system: [
            { type: "text", text: INSTRUCTIONS },
            { type: "text", text: context },
          ],
          tools: TOOL_DEFINITIONS,
          messages: history,
          thinking: { type: "adaptive", display: "summarized" },
          output_config: { effort: "medium" },
          // Caches everything up to the latest message
          cache_control: { type: "ephemeral" },
          // A refused request is answered by another model
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { signal },
      );

      for await (const event of stream) {
        if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") yield { type: "text", text: event.delta.text };
          else if (event.delta.type === "thinking_delta") yield { type: "thinking", text: event.delta.thinking };
        }
      }
      const message = await stream.finalMessage();

      const cost = usageCostUsd(message.usage);
      replyCost += cost;
      // Saved exactly as sent, for the next request
      await appendMessage(chat._id, {
        role: "assistant",
        content: message.content as unknown as Anthropic.Beta.BetaContentBlockParam[],
        usage: message.usage,
        costUsd: cost,
      });
      history.push({ role: "assistant", content: message.content as unknown as Anthropic.Beta.BetaContentBlockParam[] });

      for (const block of message.content) {
        if (block.type === "fallback") yield { type: "notice", text: `Continued by ${block.to.model}` };
      }

      if (message.stop_reason === "refusal") {
        yield { type: "notice", text: "Claude declined to answer that." };
        finished = true;
        break;
      }
      if (message.stop_reason === "max_tokens") {
        yield { type: "notice", text: "The reply hit its length limit. Ask it to continue." };
        finished = true;
        break;
      }
      if (message.stop_reason === "pause_turn") continue;

      const calls = message.content.filter((block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use");
      if (message.stop_reason !== "tool_use" || calls.length === 0) {
        finished = true;
        break;
      }

      // All results go back together, in one message
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      const summaries: Record<string, { ok: boolean; summary: string }> = {};
      for (const call of calls) {
        yield { type: "tool", id: call.id, name: call.name, input: call.input };
      }
      const outcomes = await Promise.all(calls.map((call) => runTool(call.name, call.input, { user })));
      calls.forEach((call, index) => {
        const outcome = outcomes[index];
        results.push({ type: "tool_result", tool_use_id: call.id, content: outcome.content, ...(outcome.ok ? {} : { is_error: true }) });
        summaries[call.id] = { ok: outcome.ok, summary: outcome.summary };
      });
      await appendMessage(chat._id, { role: "user", content: results, summaries });
      history.push({ role: "user", content: results });
      for (const call of calls) {
        yield { type: "tool_result", id: call.id, ...summaries[call.id] };
      }
    }

    if (!finished && !signal?.aborted) {
      yield { type: "notice", text: "Stopped after many steps. Ask it to carry on if there's more to do." };
    }

    const summary = await chatSummary(chat._id);
    yield {
      type: "done",
      costUsd: Math.round(replyCost * 10_000) / 10_000,
      chatCostUsd: summary?.costUsd ?? 0,
      title: title ?? summary?.title ?? "",
    };
  } finally {
    await releaseRun(chat._id);
  }
}

// A readable line for a failure (never the request: it
// holds the key)
export function assistantErrorMessage(error: unknown): { status: number; message: string } {
  if (error instanceof ChatError) return { status: error.status, message: error.message };
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return { status: 502, message: "Anthropic rejected the server's API key. An admin needs to update ANTHROPIC_API_KEY." };
  }
  if (error instanceof Anthropic.RateLimitError) return { status: 429, message: "Claude is busy right now. Try again in a minute." };
  if (error instanceof Anthropic.BadRequestError) return { status: 502, message: `Claude couldn't take that request: ${error.message}` };
  if (error instanceof Anthropic.APIError) return { status: 502, message: "Claude had a problem answering. Try again." };
  if (error instanceof Anthropic.APIConnectionError) return { status: 502, message: "Couldn't reach Claude. Check the connection and try again." };
  return { status: 500, message: "Something went wrong. Try again." };
}
