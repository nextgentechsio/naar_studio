import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, closeDb, db, login, loginRoot, replicateUrl, type Session } from "./helpers";

// --------------------------------------------------
// Email (through a stand-in Microsoft Graph that only
// records): copies of notifications, the welcome email
// with a set-your-password link, and forgot password.
// --------------------------------------------------

type Sent = { from: string; to: string[]; subject: string; html: string };

let root: Session;
const tag = Math.random().toString(36).slice(2, 8);
const address = (name: string) => `${name}.${tag}@example.com`;

async function mailTo(to: string, wanted = 1): Promise<Sent[]> {
  let found: Sent[] = [];
  for (let attempt = 0; attempt < 50; attempt++) {
    const all = (await (await fetch(`${replicateUrl}/__control/mail`)).json()) as Sent[];
    found = all.filter((mail) => mail.to.includes(to));
    if (found.length >= wanted) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return found;
}

const linkToken = (html: string) => {
  const match = html.match(/\/reset-password\?token=([A-Za-z0-9_-]+)/);
  if (!match) throw new Error("no link in the email");
  return match[1];
};

async function newUser(name: string, email: string | null) {
  const password = "Pass-123456789";
  const created = await api("/api/users", {
    session: root,
    json: { username: `${name}-${tag}`, name, password, role: "user", ...(email ? { email } : {}) },
  });
  expect(created.status, JSON.stringify(created.data)).toBe(201);
  return { id: (created.data.user as { id: string }).id, username: `${name}-${tag}`, password, email };
}

beforeAll(async () => {
  root = await loginRoot();
});

afterAll(closeDb);

describe("welcome email", () => {
  it("goes to a new account with an email, with a link to choose a password", async () => {
    const carol = await newUser("carol", address("carol"));
    const [mail] = await mailTo(carol.email!);
    expect(mail.from).toBe("studio@test.local");
    expect(mail.subject).toMatch(/^Welcome to /);
    expect(mail.html).toContain(carol.username);
    expect(mail.html).toContain("welcome=1");

    const token = linkToken(mail.html);
    expect((await api(`/api/auth/reset-password?token=${token}`)).data.valid).toBe(true);

    // Too short: refused, and the link still works
    const short = await api("/api/auth/reset-password", { json: { token, password: "short" } });
    expect(short.status).toBe(400);
    expect((await api(`/api/auth/reset-password?token=${token}`)).data.valid).toBe(true);

    expect((await api("/api/auth/reset-password", { json: { token, password: "Chosen-Pass-42" } })).status).toBe(200);
    await expect(login(carol.username, "Chosen-Pass-42")).resolves.toBeTruthy();

    // Once only
    const again = await api("/api/auth/reset-password", { json: { token, password: "Other-Pass-42" } });
    expect(again.status).toBe(400);
    expect(again.data.error).toMatch(/expired or was already used/);
  });

  it("isn't sent to an account without an email", async () => {
    await newUser("dave", null);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const all = (await (await fetch(`${replicateUrl}/__control/mail`)).json()) as Sent[];
    expect(all.filter((mail) => mail.html.includes(`dave-${tag}`))).toEqual([]);
  });
});

describe("forgot password", () => {
  it("emails a link (by username or email) that sets a new password and signs out other sessions", async () => {
    const erin = await newUser("erin", address("erin"));
    await mailTo(erin.email!); // the welcome email
    const session = await login(erin.username, erin.password);

    const asked = await api("/api/auth/forgot-password", { json: { identifier: erin.email!.toUpperCase() } });
    expect(asked.status).toBe(200);
    const mails = await mailTo(erin.email!, 2);
    const reset = mails.find((mail) => /Reset your/.test(mail.subject))!;
    expect(reset).toBeTruthy();

    // A newer link replaces the older one
    await api("/api/auth/forgot-password", { json: { identifier: erin.username } });
    const newest = (await mailTo(erin.email!, 3)).filter((mail) => /Reset your/.test(mail.subject)).at(-1)!;
    expect((await api(`/api/auth/reset-password?token=${linkToken(reset.html)}`)).data.valid).toBe(false);

    expect((await api("/api/auth/reset-password", { json: { token: linkToken(newest.html), password: "Brand-New-Pass-1" } })).status).toBe(200);
    await expect(login(erin.username, erin.password)).rejects.toThrow();
    await expect(login(erin.username, "Brand-New-Pass-1")).resolves.toBeTruthy();
    expect((await api("/api/auth/me", { session })).status).toBe(401);
  });

  it("answers the same for unknown accounts, and sends nothing", async () => {
    const known = await api("/api/auth/forgot-password", { json: { identifier: `erin-${tag}` } });
    const unknown = await api("/api/auth/forgot-password", { json: { identifier: `nobody-${tag}@example.com` } });
    expect(unknown.status).toBe(200);
    expect(unknown.data).toEqual(known.data);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await mailTo(`nobody-${tag}@example.com`, 0)).toEqual([]);
  });

  it("is limited to 5 requests per 15 minutes per name", async () => {
    const name = `limit-${tag}`;
    for (let i = 0; i < 5; i++) expect((await api("/api/auth/forgot-password", { json: { identifier: name } })).status).toBe(200);
    expect((await api("/api/auth/forgot-password", { json: { identifier: name } })).status).toBe(429);
  });

  it("refuses bad or made-up links", async () => {
    expect((await api("/api/auth/reset-password?token=nope")).data.valid).toBe(false);
    expect((await api("/api/auth/reset-password", { json: { token: "x".repeat(43), password: "Whatever-123" } })).status).toBe(400);
    // Only a hash of each token is stored
    const stored = await (await db()).collection("passwordTokens").findOne({});
    expect(String(stored?._id)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("notification copies", () => {
  it("go by email to chosen recipients who have an address, and not to disabled accounts", async () => {
    const fay = await newUser("fay", address("fay"));
    const gus = await newUser("gus", address("gus"));
    const hal = await newUser("hal", null);
    await mailTo(fay.email!);
    await mailTo(gus.email!);
    expect((await api(`/api/users/${gus.id}`, { session: root, method: "PATCH", json: { disabled: true } })).status).toBe(200);

    const title = `Budget news ${tag}`;
    const sent = await api("/api/notifications", {
      session: root,
      json: { title, body: "Line one\n<b>not bold</b>", level: "info", to: [fay.id, gus.id, hal.id] },
    });
    expect(sent.status).toBe(201);

    const [copy] = (await mailTo(fay.email!, 2)).filter((mail) => mail.subject === title);
    expect(copy).toBeTruthy();
    expect(copy.html).toContain("Line one<br>&lt;b&gt;not bold&lt;/b&gt;");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await mailTo(gus.email!, 2)).filter((mail) => mail.subject === title)).toEqual([]);
  });

  it("go to everyone with an address for a message to everyone", async () => {
    const ivy = await newUser("ivy", address("ivy"));
    await mailTo(ivy.email!);
    const title = `For everyone ${tag}`;
    expect((await api("/api/notifications", { session: root, json: { title, body: "", level: "info", to: "everyone" } })).status).toBe(201);
    expect((await mailTo(ivy.email!, 2)).filter((mail) => mail.subject === title)).toHaveLength(1);
  });
});
