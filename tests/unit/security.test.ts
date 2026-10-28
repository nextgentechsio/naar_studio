import { beforeAll, describe, expect, it } from "vitest";
import { isValidModelId, modelPath } from "@/lib/replicate/model";
import {
  assignableRoles,
  canAssignRole,
  canDeleteProjects,
  canManageProjects,
  canManageUser,
  canManageUsers,
  type PublicUser,
} from "@/lib/auth/roles";
import { safeNextPath } from "@/lib/auth/safe-next";

type Actor = Pick<PublicUser, "id" | "role" | "disabled">;

const superAdmin: Actor = { id: "s", role: "super_admin", disabled: false };
const admin: Actor = { id: "a", role: "admin", disabled: false };
const otherAdmin: Actor = { id: "a2", role: "admin", disabled: false };
const user: Actor = { id: "u", role: "user", disabled: false };
const disabledAdmin: Actor = { ...admin, disabled: true };

describe("roles", () => {
  it("only active admins and the super admin manage users", () => {
    expect(canManageUsers(superAdmin)).toBe(true);
    expect(canManageUsers(admin)).toBe(true);
    expect(canManageUsers(user)).toBe(false);
    expect(canManageUsers(disabledAdmin)).toBe(false);
  });

  it("admins manage plain users only", () => {
    expect(canManageUser(admin, user)).toBe(true);
    expect(canManageUser(admin, otherAdmin)).toBe(false);
    expect(canManageUser(admin, superAdmin)).toBe(false);
  });

  it("the super admin manages admins and users, never a super admin", () => {
    expect(canManageUser(superAdmin, admin)).toBe(true);
    expect(canManageUser(superAdmin, user)).toBe(true);
    expect(canManageUser(superAdmin, { id: "s2", role: "super_admin" })).toBe(false);
  });

  it("super_admin can never be assigned", () => {
    expect(canAssignRole(superAdmin, "super_admin")).toBe(false);
    expect(canAssignRole(admin, "super_admin")).toBe(false);
    expect(canAssignRole(admin, "admin")).toBe(false);
    expect(assignableRoles(superAdmin)).toEqual(["admin", "user"]);
    expect(assignableRoles(admin)).toEqual(["user"]);
    expect(assignableRoles(user)).toEqual([]);
  });

  it("project permissions", () => {
    expect(canManageProjects(admin)).toBe(true);
    expect(canManageProjects(user)).toBe(false);
    expect(canManageProjects(disabledAdmin)).toBe(false);
    expect(canDeleteProjects(superAdmin)).toBe(true);
    expect(canDeleteProjects(admin)).toBe(false);
  });
});

describe("model ids (interpolated into Replicate URLs)", () => {
  it("accepts owner/name", () => {
    for (const id of ["google/nano-banana", "a/b", "owner_1/model.v2-x"]) {
      expect(isValidModelId(id), id).toBe(true);
    }
  });

  it("rejects traversal, extra segments and odd types", () => {
    for (const id of [
      "../account",
      "google/..",
      "google/../../account",
      "a/b/c",
      "/a/b",
      "a/",
      "a%2Fb/c",
      "a/b?x=1",
      "a/b#x",
      "a /b",
      "",
      "x".repeat(201) + "/y",
      { $ne: "" },
      ["a/b"],
      null,
    ]) {
      expect(isValidModelId(id), JSON.stringify(id)).toBe(false);
    }
  });

  it("encodes each path segment", () => {
    expect(modelPath("owner/name.v1")).toBe("owner/name.v1");
  });
});

describe("safeNextPath (post-login redirect)", () => {
  const origin = "https://studio.example";

  it("keeps same-origin paths with query and hash", () => {
    expect(safeNextPath("/history?page=2#x", origin)).toBe("/history?page=2#x");
    expect(safeNextPath("/expenses", origin)).toBe("/expenses");
  });

  it("rejects anything that leaves the origin", () => {
    for (const next of [
      null,
      "",
      "https://evil.com",
      "//evil.com",
      "/\\evil.com",
      "/\t/evil.com",
      "/\n/evil.com",
      "/\r\n/evil.com",
      " //evil.com",
      "javascript:alert(1)",
      "evil.com",
    ]) {
      expect(safeNextPath(next, origin), JSON.stringify(next)).toBe("/");
    }
  });
});

describe("session tokens", () => {
  let session: typeof import("@/lib/auth/session");

  beforeAll(async () => {
    process.env.SESSION_SECRET = "x".repeat(48);
    session = await import("@/lib/auth/session");
  });

  it("round-trips uid and version", () => {
    const token = session.createSessionToken("user-1", 3);
    expect(session.verifySessionToken(token)).toMatchObject({ uid: "user-1", ver: 3 });
  });

  it("rejects tampered, truncated or foreign tokens", () => {
    const token = session.createSessionToken("user-1", 3);
    const [data, signature] = token.split(".");

    const forged = Buffer.from(
      JSON.stringify({ uid: "admin", ver: 3, exp: 9_999_999_999 })
    ).toString("base64url");

    for (const bad of [
      `${forged}.${signature}`,
      `${data}.${signature.slice(0, -2)}`,
      `${data}.`,
      `${data}`,
      `${data}.${signature}.extra`,
      "",
      null,
      undefined,
    ]) {
      expect(session.verifySessionToken(bad as string), String(bad)).toBeNull();
    }
  });

  it("rejects expired tokens", () => {
    const realNow = Date.now;
    const token = session.createSessionToken("user-1", 1);

    Date.now = () => realNow() + 8 * 24 * 60 * 60 * 1000;
    try {
      expect(session.verifySessionToken(token)).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });

  it("refuses to work with a short secret", () => {
    const secret = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "short";
    try {
      expect(session.isSessionConfigured()).toBe(false);
      expect(() => session.createSessionToken("u", 1)).toThrow();
    } finally {
      process.env.SESSION_SECRET = secret;
    }
  });
});
