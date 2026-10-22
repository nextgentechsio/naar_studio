import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, baseUrl, closeDb, createUser, login, loginRoot, type Session } from "./helpers";

// One session per account, for every role: signing in
// on a new device ends the session on the old one.

let root: Session;

beforeAll(async () => {
  root = await loginRoot();
});

afterAll(closeDb);

describe("one session per account", () => {
  it("a new sign-in ends the previous device's session", async () => {
    const user = await createUser(root, "user");
    const laptop = user.session;
    const phone = await login(user.username, user.password);

    const old = await api("/api/auth/me", { session: laptop });
    expect(old.status).toBe(401);
    expect(old.data.code).toBe("session_replaced");

    expect((await api("/api/auth/me", { session: phone })).status).toBe(200);
  });

  it("sends the old device's pages to sign-in, saying why", async () => {
    const user = await createUser(root, "user");
    const old = user.session;
    await login(user.username, user.password);

    const response = await fetch(`${baseUrl}/replicate`, {
      headers: { cookie: old.cookie },
      redirect: "manual",
    });

    expect(response.status).toBe(307);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("/login?reason=replaced");

    // …and the login page clears the dead cookie instead of
    // bouncing back to the app (that looped forever)
    const loginPage = await fetch(new URL(location, baseUrl), {
      headers: { cookie: old.cookie },
      redirect: "manual",
    });
    expect(loginPage.status).toBe(200);
    expect(loginPage.headers.get("set-cookie") ?? "").toMatch(/ai_studio_session=;/);
  });

  it("disabled or reset sessions also land on sign-in without looping", async () => {
    const user = await createUser(root, "user");
    await api(`/api/users/${user.id}`, { method: "PATCH", session: root, json: { password: "New-pass-12345678" } });

    const page = await fetch(`${baseUrl}/history`, { headers: { cookie: user.session.cookie }, redirect: "manual" });
    const location = page.headers.get("location") ?? "";
    expect(location).toContain("/login?reason=ended");

    const loginPage = await fetch(new URL(location, baseUrl), {
      headers: { cookie: user.session.cookie },
      redirect: "manual",
    });
    expect(loginPage.status).toBe(200);
  });

  it("a valid session still skips the login page", async () => {
    const response = await fetch(`${baseUrl}/login`, { headers: { cookie: root.cookie }, redirect: "manual" });
    expect(response.status).toBe(307);
  });

  it("applies to admins and the super admin too", async () => {
    const admin = await createUser(root, "admin");
    await login(admin.username, admin.password);
    expect((await api("/api/users", { session: admin.session })).status).toBe(401);

    const { username, password } = { username: "root", password: "Root-pass-123456" };
    const oldRoot = root;
    root = await login(username, password);

    expect((await api("/api/auth/me", { session: oldRoot })).data.code).toBe("session_replaced");
    expect((await api("/api/auth/me", { session: root })).status).toBe(200);
  });

  it("a disabled account is not reported as 'signed in elsewhere'", async () => {
    const user = await createUser(root, "user");
    await api(`/api/users/${user.id}`, { method: "PATCH", session: root, json: { disabled: true } });

    const response = await api("/api/auth/me", { session: user.session });
    expect(response.status).toBe(401);
    expect(response.data.code).toBeUndefined();
  });

  it("parallel sign-ins leave exactly one working session", async () => {
    const user = await createUser(root, "user");

    const sessions = await Promise.all(
      Array.from({ length: 4 }, () => login(user.username, user.password))
    );

    const working = await Promise.all(
      sessions.map(async (session) => (await api("/api/auth/me", { session })).status)
    );

    expect(working.filter((status) => status === 200)).toHaveLength(1);
  });
});
