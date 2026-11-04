import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { PROMPT_MAX, type StreamEvent } from "@/lib/assistant/shared";
import { assistantConfigured, assistantErrorMessage, runAssistant } from "@/lib/assistant/run";

export const runtime = "nodejs";
// Replies with several tool rounds can take minutes
export const maxDuration = 300;

// --------------------------------------------------
// SEND A MESSAGE TO THE ASSISTANT
//
// POST { text, attachments? } → a stream of server-sent
// events (attachments: URLs from /api/assistant/upload), one
// JSON StreamEvent each (lib/assistant/shared.ts): the
// reply's text and thinking as they're written, tool
// activity, then "done" (or "error"). Closing the page
// stops the reply; what finished is already saved.
// --------------------------------------------------

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const { id } = await context.params;

  const body = ((await request.json().catch(() => null)) ?? {}) as { text?: unknown; attachments?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const attached = Array.isArray(body.attachments) && body.attachments.length > 0;
  if (!text && !attached) return NextResponse.json({ error: "Write a message" }, { status: 400 });
  if (text.length > PROMPT_MAX) {
    return NextResponse.json({ error: `Keep messages under ${PROMPT_MAX} characters` }, { status: 400 });
  }
  if (!assistantConfigured()) {
    return NextResponse.json(
      { error: "The assistant isn't set up yet. An admin needs to add ANTHROPIC_API_KEY." },
      { status: 503 },
    );
  }

  const encoder = new TextEncoder();
  const events = runAssistant({ user: auth.user, chatId: id, prompt: text, attachments: body.attachments, signal: request.signal });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // The page went away
        }
      };
      try {
        for await (const event of events) send(event);
      } catch (error) {
        if (!request.signal.aborted) {
          console.error("Assistant reply error:", error instanceof Error ? error.message : error);
          send({ type: "error", message: assistantErrorMessage(error).message });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed
        }
      }
    },
    async cancel() {
      await events.return(undefined);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
