import { ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FAKE_BLOB_TOKEN } from "./fake-replicate";
import { api, baseUrl, closeDb, createProject, createUser, db, loginRoot, replicateUrl, startGeneration } from "./helpers";

// --------------------------------------------------
// Assistant: private chats, streamed replies, read-only
// tools run as the user, history replayed unchanged.
// Claude is the fake in fake-anthropic.ts (no cost).
// --------------------------------------------------

type Session = Awaited<ReturnType<typeof loginRoot>>;
type User = Awaited<ReturnType<typeof createUser>>;
type Event = { type: string; [key: string]: unknown };

let root: Session;
let alice: User;
let bob: User;
let project: { name: string };

beforeAll(async () => {
  root = await loginRoot();
  alice = await createUser(root, "user", { name: `Alice ${Date.now()}` });
  bob = await createUser(root, "user", { name: `Bob ${Date.now()}` });
  project = await createProject(root);
});

afterAll(closeDb);

async function newChat(user: User) {
  const { status, data } = await api("/api/assistant/chats", { session: user.session, method: "POST" });
  expect(status).toBe(201);
  return data.chat as { id: string; title: string };
}

// Sends a message and reads the whole event stream
async function ask(user: User, chatId: string, text: string, attachments?: string[]) {
  const response = await fetch(`${baseUrl}/api/assistant/chats/${chatId}/messages`, {
    method: "POST",
    headers: { cookie: user.session.cookie, "content-type": "application/json" },
    body: JSON.stringify({ text, attachments }),
  });
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    return { status: response.status, events: [] as Event[], body: await response.json() };
  }
  const raw = await response.text();
  const events = raw
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice(6)) as Event);
  return { status: response.status, events, body: null };
}

const textOf = (events: Event[]) =>
  events
    .filter((event) => event.type === "text")
    .map((event) => event.text)
    .join("");

async function claudeRequests() {
  return (await (await fetch(`${replicateUrl}/__control/anthropic`)).json()) as {
    headers: Record<string, string>;
    body: Record<string, unknown>;
  }[];
}

describe("assistant", () => {
  it("chats are private to their owner", async () => {
    const chat = await newChat(alice);
    expect((await api("/api/assistant/chats", { session: alice.session })).data).toMatchObject({ configured: true });
    expect(((await api("/api/assistant/chats", { session: alice.session })).data.chats as { id: string }[]).some((item) => item.id === chat.id)).toBe(true);
    expect(((await api("/api/assistant/chats", { session: bob.session })).data.chats as { id: string }[]).some((item) => item.id === chat.id)).toBe(false);

    expect((await api(`/api/assistant/chats/${chat.id}`, { session: bob.session })).status).toBe(404);
    expect((await api(`/api/assistant/chats/${chat.id}`, { session: root })).status).toBe(404);
    expect((await api(`/api/assistant/chats/${chat.id}`, { session: bob.session, method: "DELETE" })).status).toBe(404);
    const sent = await ask(bob, chat.id, "hello");
    expect(sent.events.find((event) => event.type === "error")?.message).toBe("Chat not found");
    expect((await api("/api/assistant/chats")).status).toBe(401);
  });

  it("streams a reply, names the chat, saves it, and tracks the cost", async () => {
    const chat = await newChat(alice);
    const { events } = await ask(alice, chat.id, "Hello there, studio assistant");
    expect(textOf(events)).toBe("You said: Hello there, studio assistant");
    expect(events.some((event) => event.type === "thinking")).toBe(true);
    const done = events.find((event) => event.type === "done")!;
    // 1000 in × $4 + 200 out × $20 + 500 cache read × $0.20 per million
    expect(done).toMatchObject({ costUsd: 0.0081, chatCostUsd: 0.0081, title: "Hello there, studio assistant" });

    const { data } = await api(`/api/assistant/chats/${chat.id}`, { session: alice.session });
    expect(data.chat).toMatchObject({
      title: "Hello there, studio assistant",
      costUsd: 0.0081,
      turns: [
        { role: "user", parts: [{ kind: "user", text: "Hello there, studio assistant" }] },
        { role: "assistant", parts: [{ kind: "thinking" }, { kind: "text", text: "You said: Hello there, studio assistant" }] },
      ],
    });
  });

  it("asks Claude the configured way and replays history unchanged", async () => {
    const chat = await newChat(alice);
    const before = (await claudeRequests()).length;
    await ask(alice, chat.id, "first");
    await ask(alice, chat.id, "second");
    const [first, second] = (await claudeRequests()).slice(before);

    expect(first.body).toMatchObject({
      model: "claude-opus-5-5",
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "medium" },
      cache_control: { type: "ephemeral" },
      fallbacks: "default",
      stream: true,
    });
    expect(first.headers["anthropic-beta"]).toContain("server-side-fallback-2026-07-01");
    expect((first.body.tools as { name: string }[]).map((tool) => tool.name)).toEqual([
      "list_projects",
      "find_models",
      "model_details",
      "estimate_cost",
      "search_history",
      "list_elements",
    ]);
    // The fixed instructions come first (cacheable)
    expect((first.body.system as { text: string }[])[0].text).not.toContain(alice.username);

    // Second request: the first exchange as it was, thinking signature included
    const messages = second.body.messages as { role: string; content: Record<string, unknown>[] }[];
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(messages[1].content[0]).toMatchObject({ type: "thinking", thinking: "Considering the request.", signature: "fake-signature" });
  });

  it("runs read-only tools as the user and shows their results", async () => {
    const chat = await newChat(alice);
    const { events } = await ask(alice, chat.id, "Which projects? [tool:list_projects]");

    expect(events.find((event) => event.type === "tool")).toMatchObject({ name: "list_projects" });
    const result = events.find((event) => event.type === "tool_result")!;
    expect(result.ok).toBe(true);
    expect(result.summary).toMatch(/found/);
    expect(textOf(events)).toContain(project.name);

    // The page shows the call with its result
    const { data } = await api(`/api/assistant/chats/${chat.id}`, { session: alice.session });
    const parts = ((data.chat as { turns: unknown }).turns as { role: string; parts: { kind: string; result?: { ok: boolean } }[] }[])[1].parts;
    expect(parts.find((part) => part.kind === "tool")?.result?.ok).toBe(true);
  });

  it("finds models and prices runs without running anything", async () => {
    const chat = await newChat(alice);
    const before = (await (await fetch(`${replicateUrl}/__control/requests`)).json()).length;

    const found = await ask(alice, chat.id, '[tool:find_models {"platform":"elevenlabs","query":"flash"}]');
    expect(textOf(found.events)).toContain("tts/eleven_flash_v2_5");

    const priced = await ask(alice, chat.id, '[tool:estimate_cost {"platform":"elevenlabs","model":"tts/eleven_flash_v2_5","inputs":{"prompt":"hello world"}}]');
    expect(priced.events.find((event) => event.type === "tool_result")).toMatchObject({ ok: true, summary: "≈ $0.000" });

    const replicate = await ask(alice, chat.id, '[tool:estimate_cost {"platform":"replicate","model":"google/nano-banana","inputs":{}}]');
    expect(replicate.events.find((event) => event.type === "tool_result")).toMatchObject({ ok: true, summary: "≈ $0.039" });

    // No run was started anywhere
    const after = (await (await fetch(`${replicateUrl}/__control/requests`)).json()) as { method: string; path: string }[];
    expect(after.slice(before).filter((request) => request.method === "POST")).toEqual([]);
  });

  it("only searches the history the user may see", async () => {
    const marker = `zebra-${Date.now()}`;
    await startGeneration(bob.session, project.name, "google/nano-banana", { prompt: `a ${marker} at dawn` });

    const aliceChat = await newChat(alice);
    const mine = await ask(alice, aliceChat.id, `[tool:search_history {"query":"${marker}"}]`);
    expect(mine.events.find((event) => event.type === "tool_result")?.summary).toBe("0 found");

    const bobChat = await newChat(bob);
    const theirs = await ask(bob, bobChat.id, `[tool:search_history {"query":"${marker}"}]`);
    expect(theirs.events.find((event) => event.type === "tool_result")?.summary).toBe("1 found");
  });

  it("reports bad tool input to Claude instead of failing", async () => {
    const chat = await newChat(alice);
    const { events } = await ask(alice, chat.id, '[tool:search_history {"limit":99}] [tool:no_such_tool]');
    const results = events.filter((event) => event.type === "tool_result");
    expect(results.map((event) => [event.ok, event.summary])).toEqual([
      [false, "Invalid input"],
      [false, "Unknown tool"],
    ]);
    expect(events.some((event) => event.type === "done")).toBe(true);
  });

  it("handles refusals, a bad key, and messages it can't take", async () => {
    const chat = await newChat(alice);
    const refused = await ask(alice, chat.id, "[refuse]");
    expect(refused.events.find((event) => event.type === "notice")?.text).toBe("Claude declined to answer that.");

    const badKey = await ask(alice, chat.id, "[badkey]");
    expect(badKey.events.find((event) => event.type === "error")?.message).toContain("ANTHROPIC_API_KEY");

    expect((await ask(alice, chat.id, "   ")).status).toBe(400);
    expect((await ask(alice, chat.id, "x".repeat(8001))).status).toBe(400);
  });

  it("writes one reply at a time per chat", async () => {
    const chat = await newChat(alice);
    const slow = ask(alice, chat.id, "[slow] take your time");
    await new Promise((resolve) => setTimeout(resolve, 800));
    const second = await ask(alice, chat.id, "and another thing");
    expect(second.events.find((event) => event.type === "error")?.message).toBe("A reply is still being written in this chat");
    expect((await slow).events.some((event) => event.type === "done")).toBe(true);
    // Free again
    expect((await ask(alice, chat.id, "now")).events.some((event) => event.type === "done")).toBe(true);
  });

  it("repairs a reply cut off after asking for a tool", async () => {
    const chat = await newChat(alice);
    await ask(alice, chat.id, "start");
    // As if the tab closed after Claude asked for a tool
    await (await db()).collection("assistantMessages").insertOne({
      _id: new ObjectId(),
      chatId: new ObjectId(chat.id),
      role: "assistant",
      content: [{ type: "tool_use", id: "toolu_cut", name: "list_projects", input: {} }],
      createdAt: new Date(),
    });

    const before = (await claudeRequests()).length;
    const { events } = await ask(alice, chat.id, "still there?");
    expect(events.some((event) => event.type === "done")).toBe(true);
    const sent = (await claudeRequests())[before].body.messages as { role: string; content: Record<string, unknown>[] }[];
    const repair = sent[sent.length - 2];
    expect(repair.content[0]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_cut", is_error: true });
  });

  it("renames and deletes chats", async () => {
    const chat = await newChat(alice);
    await ask(alice, chat.id, "something to keep");
    expect((await api(`/api/assistant/chats/${chat.id}`, { session: alice.session, method: "PATCH", json: { title: "  " } })).status).toBe(400);
    expect((await api(`/api/assistant/chats/${chat.id}`, { session: alice.session, method: "PATCH", json: { title: "Launch ideas" } })).data.chat).toMatchObject({
      title: "Launch ideas",
    });

    expect((await api(`/api/assistant/chats/${chat.id}`, { session: alice.session, method: "DELETE" })).status).toBe(204);
    expect((await api(`/api/assistant/chats/${chat.id}`, { session: alice.session })).status).toBe(404);
    expect(await (await db()).collection("assistantMessages").countDocuments({ chatId: new ObjectId(chat.id) })).toBe(0);
  });

  describe("attachments", () => {
    // A file in storage, as if the browser uploaded it
    async function stored(pathname: string, type: string, bytes = 2000) {
      const response = await fetch(`${replicateUrl}/blob/?pathname=${encodeURIComponent(pathname)}`, {
        method: "PUT",
        headers: { authorization: `Bearer ${FAKE_BLOB_TOKEN}`, "x-content-type": type },
        body: new Uint8Array(bytes),
      });
      return ((await response.json()) as { url: string }).url;
    }
    const folder = (user: User) => `assistant/${user.id.replace(/[^\w-]+/g, "_")}/`;

    it("sends images and PDFs to Claude, shows them, and deletes them with the chat", async () => {
      const image = await stored(`${folder(alice)}look.png`, "image/png");
      const pdf = await stored(`${folder(alice)}brief.pdf`, "application/pdf");
      const chat = await newChat(alice);

      const before = (await claudeRequests()).length;
      const { events } = await ask(alice, chat.id, "What do you see?", [image, pdf]);
      expect(textOf(events)).toBe("You said: What do you see? (with an image and a PDF)");

      const sent = (await claudeRequests())[before].body.messages as { content: Record<string, unknown>[] }[];
      expect(sent[0].content).toMatchObject([
        { type: "image", source: { type: "url", url: image } },
        // Named from the file (real storage's random suffix removed)
        { type: "document", source: { type: "url", url: pdf }, title: expect.stringMatching(/^brief.*\.pdf$/) },
        { type: "text", text: "What do you see?" },
      ]);

      const { data } = await api(`/api/assistant/chats/${chat.id}`, { session: alice.session });
      expect((data.chat as { turns: { parts: unknown[] }[] }).turns[0].parts).toMatchObject([
        { kind: "attachment", type: "image", url: image },
        { kind: "attachment", type: "pdf", url: pdf, name: expect.stringMatching(/^brief.*\.pdf$/) },
        { kind: "user", text: "What do you see?" },
      ]);

      // Files alone are a message too
      const alone = await ask(alice, chat.id, "", [image]);
      expect(textOf(alone.events)).toBe("You said:  (with an image)");

      expect((await api(`/api/assistant/chats/${chat.id}`, { session: alice.session, method: "DELETE" })).status).toBe(204);
      const { blobs: left } = (await (await fetch(`${replicateUrl}/__control/blobs`)).json()) as { blobs: { url: string }[] };
      expect(left.some((blob) => blob.url === image || blob.url === pdf)).toBe(false);
    });

    it("only takes the sender's own images and PDFs, within size", async () => {
      const chat = await newChat(alice);
      const bobs = await stored(`${folder(bob)}theirs.png`, "image/png");
      const video = await stored(`${folder(alice)}clip.mp4`, "video/mp4");
      const huge = await stored(`${folder(alice)}huge.png`, "image/png", 6 * 1024 * 1024);
      const outside = await stored(`library/${alice.id}/elsewhere.png`, "image/png");

      const error = async (urls: unknown) =>
        (await ask(alice, chat.id, "look", urls as string[])).events.find((event) => event.type === "error")?.message;

      expect(await error([bobs])).toBe("That file isn't one of your uploads");
      expect(await error([outside])).toBe("That file isn't one of your uploads");
      expect(await error([video])).toContain("Only images");
      expect(await error([huge])).toContain("larger than 5 MB");
      expect(await error(["https://example.com/nope.png"])).toContain("wasn't found");
      expect(await error([bobs, bobs, bobs, bobs, bobs, video].map((url, index) => `${url}?${index}`))).toBe("Attach at most 5 files");

      // Nothing was saved from those attempts
      const { data } = await api(`/api/assistant/chats/${chat.id}`, { session: alice.session });
      expect((data.chat as { turns: unknown[] }).turns).toEqual([]);
    });

    it("upload tokens only cover the user's own assistant folder", async () => {
      const token = (pathname: string) =>
        api("/api/assistant/upload", {
          session: alice.session,
          json: { type: "blob.generate-client-token", payload: { pathname, callbackUrl: "", clientPayload: null, multipart: false } },
        });
      expect((await token(`${folder(alice)}ok.png`)).status).toBe(200);
      expect((await token(`${folder(bob)}nope.png`)).status).toBe(400);
      expect((await token(`${folder(alice)}../x.png`)).status).toBe(400);
    });
  });
});
