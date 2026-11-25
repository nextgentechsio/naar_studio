import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/auth";
import { canManageProjects } from "@/lib/auth/roles";
import BudgetsView from "./BudgetsView";

export const metadata: Metadata = { title: "Budgets" };

// Admins and the super admin only (the API re-checks)
export default async function Page() {
  const user = await getCurrentUser();

  if (!user || !canManageProjects(user)) redirect("/");

  return <BudgetsView />;
}
