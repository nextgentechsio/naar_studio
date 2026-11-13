import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, closeDb, createUser, loginRoot, type Session } from "./helpers";

// --------------------------------------------------
// Accounts can have an email: admins set it on the Users
// page, users add their own on Account, and either the
// username or the email signs in.
// --------------------------------------------------

let root: Session;
let alice: Awaited<ReturnType<typeof createUser>>;
let bob: Awaited<ReturnType<typeof createUser>>;

// Note: each sign-in ends the account's earlier session
// (one session per account), so calls after one use the
// cookie it returns
const signIn = (username: string, password: string) =>
  api("/api/auth/login", { json: { username, password } });

const sessionFrom = (response: Awaited<ReturnType<typeof api>>, username: string): Session => ({
  cookie: (response.headers.get("set-cookie") ?? "").split(";")[0],
  username,
});

beforeAll(async () => {
  root = await loginRoot();
  alice = await createUser(root, "user");
  bob = await createUser(root, "user");
});

afterAll(closeDb);

describe("account email", () => {
  it("an admin sets it, and the account signs in with it in any case", async () => {
    const set = await api(`/api/users/${alice.id}`, { session: root, method: "PATCH", json: { email: "  Alice@Example.COM " } });
    expect(set.status).toBe(200);
    expect((set.data.user as { email: string }).email).toBe("alice@example.com");

    const me = await api("/api/auth/me", { session: alice.session });
    expect((me.data.user as { email: string }).email).toBe("alice@example.com");

    const byEmail = await signIn("ALICE@example.com", alice.password);
    expect(byEmail.status).toBe(200);
    expect((byEmail.data.user as { username: string }).username).toBe(alice.username);
    expect((await api("/api/auth/me", { session: sessionFrom(byEmail, alice.username) })).status).toBe(200);
    expect((await signIn(alice.username, alice.password)).status).toBe(200);
    const wrong = await signIn("alice@example.com", "not-her-password");
    expect(wrong.status).toBe(401);
    expect(wrong.data.error).toBe("Invalid username, email or password");
    expect((await signIn("nobody@example.com", alice.password)).status).toBe(401);

    // Listed with it
    const list = await api("/api/users", { session: root });
    expect((list.data.users as { id: string; email: string | null }[]).find((user) => user.id === alice.id)?.email).toBe("alice@example.com");
  });

  it("is unique, must look like an address, and can be created with", async () => {
    const taken = await api(`/api/users/${bob.id}`, { session: root, method: "PATCH", json: { email: "alice@example.com" } });
    expect(taken.status).toBe(409);
    expect(taken.data.error).toBe("That email already belongs to another account");

    for (const bad of ["not-an-email", "a@b", "@example.com", 42]) {
      const response = await api(`/api/users/${bob.id}`, { session: root, method: "PATCH", json: { email: bad } });
      expect(response.status, String(bad)).toBe(400);
    }

    const created = await api("/api/users", {
      session: root,
      json: { username: `carol${Date.now().toString(36)}`, name: "Carol", email: "Carol@example.com", password: "carol-pass-1", role: "user" },
    });
    expect(created.status).toBe(201);
    expect((created.data.user as { email: string }).email).toBe("carol@example.com");
    expect((await signIn("carol@example.com", "carol-pass-1")).status).toBe(200);

    const duplicate = await api("/api/users", {
      session: root,
      json: { username: `dave${Date.now().toString(36)}`, name: "Dave", email: "carol@example.com", password: "dave-pass-1", role: "user" },
    });
    expect(duplicate.status).toBe(409);
  });

  it("a user adds and removes their own, nobody else's", async () => {
    const mine = await api("/api/account", { session: bob.session, method: "PATCH", json: { email: "bob@example.com" } });
    expect(mine.status).toBe(200);
    const byEmail = await signIn("bob@example.com", bob.password);
    expect(byEmail.status).toBe(200);
    let session = sessionFrom(byEmail, bob.username);

    // Another account's email can't be taken this way either
    expect((await api("/api/account", { session, method: "PATCH", json: { email: "alice@example.com" } })).status).toBe(409);
    expect((await api("/api/account", { session, method: "PATCH", json: {} })).status).toBe(400);
    expect((await api("/api/account", { method: "PATCH", json: { email: "x@example.com" } })).status).toBe(401);

    // Users still can't change other accounts
    expect((await api(`/api/users/${alice.id}`, { session, method: "PATCH", json: { email: "" } })).status).toBe(403);

    // Clearing it ends email sign-in; the username still works
    const cleared = await api("/api/account", { session, method: "PATCH", json: { email: "" } });
    expect(cleared.status).toBe(200);
    expect((cleared.data.user as { email: string | null }).email).toBeNull();
    expect((await signIn("bob@example.com", bob.password)).status).toBe(401);
    const byName = await signIn(bob.username, bob.password);
    expect(byName.status).toBe(200);
    session = sessionFrom(byName, bob.username);
    expect((await api("/api/auth/me", { session })).status).toBe(200);
  });
});
