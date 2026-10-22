import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canManageUsers } from "@/lib/roles";
import UsersView from "./UsersView";

export const metadata: Metadata = { title: "Users" };

// Admins and the super admin only. The nav hides the
// link for others; this stops a typed URL too (and the
// API re-checks every action anyway).
export default async function Page() {
  const user = await getCurrentUser();

  if (!user || !canManageUsers(user)) redirect("/replicate");

  return <UsersView />;
}
