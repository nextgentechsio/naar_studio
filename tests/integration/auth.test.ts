import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  api,
  baseUrl,
  closeDb,
  createProject,
  createUser,
  login,
  loginRoot,
  type Session,
} from "./helpers";

let root: Session;

beforeAll(async () => {
  root = await loginRoot();
});

afterAll(closeDb);

describe("authentication", () => {
  it("every API route refuses anonymous requests", async () => {
    const routes: [string, string][] = [
      ["GET", "/api/auth/me"],
      ["GET", "/api/users"],
      ["POST", "/api/users"],
      ["GET", "/api/projects"],
      ["POST", "/api/projects"],
      ["GET", "/api/generations"],
      ["GET", "/api/generations/x"],
      ["POST", "/api/generate"],
      ["GET", "/api/predictions/x"],
      ["GET", "/api/expenses"],
      ["GET", "/api/expenses/entries"],
      ["GET", "/api/download?url=https://replicate.delivery/x.png"],
      ["POST", "/api/upload"],
      ["GET", "/api/models/schema?model=a/b"],
      ["GET", "/api/models/search?q=x"],
      ["GET", "/api/pricing"],
      ["GET", "/api/projects/x/image"],
    ];

    for (const [method, path] of routes) {
      const { status } = await api(path, { method });
      expect(status, `${method} ${path}`).toBe(401);
    }
  });

  it("pages redirect anonymous visitors to sign-in, keeping the target", async () => {
    const response = await fetch(`${baseUrl}/history?page=2`, { redirect: "manual" });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain(
      "/login?next=%2Fhistory%3Fpage%3D2"
    );
  });

  it("rejects forged, tampered and garbage cookies", async () => {
    const value = root.cookie.split("=")[1];
    const [data, signature] = value.split(".");
    const forged = Buffer.from(
      JSON.stringify({ uid: "someone", ver: 1, exp: 9_999_999_999 })
    ).toString("base64url");

    for (const cookie of [
      `ai_studio_session=${forged}.${signature}`,
      `ai_studio_session=${data}.${signature}x`,
      "ai_studio_session=",
      "ai_studio_session=%%%",
    ]) {
      const { status } = await api("/api/auth/me", { session: { cookie, username: "" } });
      expect(status, cookie).toBe(401);
    }
  });

  it("signs in and reports the account", async () => {
    const { status, data } = await api("/api/auth/me", { session: root });
    expect(status).toBe(200);
    expect(data.user).toMatchObject({ username: "root", role: "super_admin" });
    expect(JSON.stringify(data)).not.toContain("passwordHash");
  });

  it("rejects wrong passwords and malformed bodies without errors", async () => {
    for (const json of [
      { username: "root", password: "wrong-password" },
      { username: { $ne: "" }, password: { $ne: "" } },
      { username: ["root"], password: "x" },
      {},
      null,
    ]) {
      const { status } = await api("/api/auth/login", { json });
      expect(status, JSON.stringify(json)).toBe(401);
    }

    const invalidJson = await api("/api/auth/login", {
      body: "{not json",
      headers: { "content-type": "application/json" },
    });
    expect(invalidJson.status).toBe(401);
  });

  it("limits guesses even when they arrive in parallel", async () => {
    const { username } = await createUser(root, "user");

    const statuses = await Promise.all(
      Array.from({ length: 20 }, () =>
        api("/api/auth/login", { json: { username, password: "wrong" } }).then(
          (response) => response.status
        )
      )
    );

    expect(statuses.filter((status) => status === 401).length).toBeLessThanOrEqual(5);
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThanOrEqual(15);
  });

  it("signs a disabled user out immediately", async () => {
    const user = await createUser(root, "user");
    expect((await api("/api/auth/me", { session: user.session })).status).toBe(200);

    await api(`/api/users/${user.id}`, {
      method: "PATCH",
      session: root,
      json: { disabled: true },
    });

    expect((await api("/api/auth/me", { session: user.session })).status).toBe(401);
    await expect(login(user.username, user.password)).rejects.toThrow();
  });

  it("revokes old sessions when a password is reset", async () => {
    const user = await createUser(root, "user");

    await api(`/api/users/${user.id}`, {
      method: "PATCH",
      session: root,
      json: { password: "Another-pass-123" },
    });

    expect((await api("/api/auth/me", { session: user.session })).status).toBe(401);
    await login(user.username, "Another-pass-123");
  });
});

describe("authorization", () => {
  let admin: Awaited<ReturnType<typeof createUser>>;
  let user: Awaited<ReturnType<typeof createUser>>;

  beforeAll(async () => {
    admin = await createUser(root, "admin");
    user = await createUser(root, "user");
  });

  it("plain users manage no one and no project", async () => {
    expect((await api("/api/users", { session: user.session })).status).toBe(403);
    expect(
      (await api("/api/users", {
        session: user.session,
        json: { username: "x1", name: "x", password: "Pass-123456789", role: "user" },
      })).status
    ).toBe(403);
    expect(
      (await api("/api/projects", { session: user.session, json: { name: "Nope" } })).status
    ).toBe(403);
  });

  it("admins manage plain users only, and can't hand out roles", async () => {
    const other = await createUser(root, "admin");

    const tryCreate = (role: string) =>
      api("/api/users", {
        session: admin.session,
        json: { username: `x${Date.now()}${role}`, name: "x", password: "Pass-123456789", role },
      });

    expect((await tryCreate("admin")).status).toBe(403);
    expect((await tryCreate("super_admin")).status).toBe(403);
    expect((await tryCreate("user")).status).toBe(201);

    for (const target of [other.id, (await rootId())]) {
      const { status } = await api(`/api/users/${target}`, {
        method: "PATCH",
        session: admin.session,
        json: { name: "hijacked" },
      });
      expect(status).toBe(403);
    }

    // Promote a user to admin: not allowed for an admin
    const promote = await api(`/api/users/${user.id}`, {
      method: "PATCH",
      session: admin.session,
      json: { role: "admin" },
    });
    expect(promote.status).toBe(403);
  });

  it("nobody can become super admin or change their own role", async () => {
    const self = await api(`/api/users/${admin.id}`, {
      method: "PATCH",
      session: admin.session,
      json: { role: "super_admin" },
    });
    expect(self.status).toBeGreaterThanOrEqual(400);

    const viaRoot = await api(`/api/users/${user.id}`, {
      method: "PATCH",
      session: root,
      json: { role: "super_admin" },
    });
    expect(viaRoot.status).toBeGreaterThanOrEqual(400);

    const me = await api("/api/auth/me", { session: admin.session });
    expect((me.data.user as { role: string }).role).toBe("admin");
  });

  it("admins manage projects but only the super admin deletes them", async () => {
    const project = await createProject(admin.session);

    expect(
      (await api(`/api/projects/${project.id}`, {
        method: "PATCH",
        session: admin.session,
        json: { status: "archived" },
      })).status
    ).toBe(200);

    expect(
      (await api(`/api/projects/${project.id}`, { method: "DELETE", session: admin.session }))
        .status
    ).toBe(403);
    expect(
      (await api(`/api/projects/${project.id}`, { method: "DELETE", session: root })).status
    ).toBe(200);
  });

  it("validates user and project input types", async () => {
    for (const json of [
      { username: { $gt: "" }, name: "x", password: "Pass-123456789", role: "user" },
      { username: "ok-name", name: "x", password: "short", role: "user" },
      { username: "ok-name2", name: "x", password: "Pass-123456789", role: "god" },
    ]) {
      const { status } = await api("/api/users", { session: root, json });
      expect(status, JSON.stringify(json)).toBe(400);
    }

    for (const json of [{ name: "" }, { name: { $ne: "" } }, { name: "x".repeat(61) }]) {
      const { status } = await api("/api/projects", { session: root, json });
      expect(status, JSON.stringify(json)).toBe(400);
    }
  });

  it("refuses duplicate names case-insensitively", async () => {
    const project = await createProject(root);
    const again = await api("/api/projects", {
      session: root,
      json: { name: project.name.toUpperCase() },
    });
    expect(again.status).toBe(409);
  });

  async function rootId() {
    const { data } = await api("/api/auth/me", { session: root });
    return (data.user as { id: string }).id;
  }
});
