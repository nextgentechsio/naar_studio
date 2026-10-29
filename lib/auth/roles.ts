// --------------------------------------------------
// ROLES & PERMISSIONS
//
// Pure functions only, so both the server (authoritative)
// and the client (to hide controls) can import this.
//
// super_admin: exactly one, stored in MongoDB (seeded
//              from .env.local on first start); manages
//              all admins and users
// admin:       manages accounts with the "user" role
// user:        manages no one
// --------------------------------------------------

import type { Presence } from "@/lib/auth/presence";

export const ROLES = [
  "super_admin",
  "admin",
  "user",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  user: "User",
};

export type PublicUser = {
  id: string;
  username: string;
  name: string;
  role: Role;
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
  // Only included for the super admin (Users page)
  presence?: Presence;
};

type Actor = Pick<PublicUser, "id" | "role" | "disabled">;
type Target = Pick<PublicUser, "id" | "role">;

export function isRole(value: unknown): value is Role {
  return (
    typeof value === "string" &&
    (ROLES as readonly string[]).includes(value)
  );
}

export function canManageUsers(actor: Actor): boolean {
  return (
    !actor.disabled &&
    (actor.role === "super_admin" ||
      actor.role === "admin")
  );
}

export function canManageUser(
  actor: Actor,
  target: Target
): boolean {
  if (!canManageUsers(actor)) return false;

  // The super admin edits only themselves (name and
  // password), never another super admin
  if (actor.role === "super_admin") {
    return target.role !== "super_admin";
  }

  // admin
  return target.role === "user";
}

export function canAssignRole(
  actor: Actor,
  role: Role
): boolean {
  if (!canManageUsers(actor)) return false;

  // There is exactly one super admin, created from
  // .env.local; the role can't be handed out in the app
  if (role === "super_admin") return false;

  if (actor.role === "super_admin") return true;

  // admin
  return role === "user";
}

// Projects: created, edited and archived by admins and
// the super admin; every signed-in user can pick from
// active projects.
export function canManageProjects(actor: Actor): boolean {
  return (
    !actor.disabled &&
    (actor.role === "super_admin" || actor.role === "admin")
  );
}

// Permanent delete stays with the super admin (it can't
// be undone; archiving is the everyday option).
export function canDeleteProjects(actor: Actor): boolean {
  return !actor.disabled && actor.role === "super_admin";
}

// Removing a run everywhere, its expense included
export function canDeleteGenerations(actor: Actor): boolean {
  return !actor.disabled && actor.role === "super_admin";
}

// Hiding a run from everyone else, and seeing hidden runs
export function canHideGenerations(actor: Actor): boolean {
  return !actor.disabled && actor.role === "super_admin";
}

// Seeing every user's library files and elements (read
// only), with who added each
export function canViewAllMedia(actor: Actor): boolean {
  return !actor.disabled && actor.role === "super_admin";
}

// Deleting any user's library files and elements (only
// their owner can edit them)
export function canDeleteAllMedia(actor: Actor): boolean {
  return !actor.disabled && actor.role === "super_admin";
}

export type PublicProject = {
  id: string;
  name: string;
  description: string;
  status: "active" | "archived";
  // Versioned URL (changes when the photo does), or
  // null when the project has no photo
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export function assignableRoles(actor: Actor): Role[] {
  return ROLES.filter((role) =>
    canAssignRole(actor, role)
  );
}
