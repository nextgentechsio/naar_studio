import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/auth";
import { canManageUsers } from "@/lib/auth/roles";
import ApiKeysView from "./ApiKeysView";

export const metadata: Metadata = { title: "API keys" };

// Admins and the super admin only (the API re-checks
// every action)
export default async function Page() {
  const user = await getCurrentUser();

  if (!user || !canManageUsers(user)) redirect("/");

  return <ApiKeysView />;
}
