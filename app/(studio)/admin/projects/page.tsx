import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/auth";
import { canManageProjects } from "@/lib/auth/roles";
import ProjectsView from "./ProjectsView";

export const metadata: Metadata = { title: "Projects" };

// Admins and the super admin only (the API re-checks
// every action, and only the super admin can delete)
export default async function Page() {
  const user = await getCurrentUser();

  if (!user || !canManageProjects(user)) redirect("/replicate");

  return <ProjectsView />;
}
