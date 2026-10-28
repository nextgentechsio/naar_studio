"use client";

import { useStudio } from "@/app/(studio)/_components/StudioProvider";
import ProjectsAdmin from "@/app/components/ProjectsAdmin";
import { PageHeader } from "@/app/components/ui/primitives";
import { canDeleteProjects } from "@/lib/auth/roles";

export default function ProjectsView() {
  const { currentUser, refreshProjects } = useStudio();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Projects"
        description="Create projects, add a photo, and archive the ones you're done with. Spend is charged to a project."
      />

      {/* Refreshes the shared list so the Generate
          dropdown picks up changes immediately */}
      <ProjectsAdmin
        canDelete={canDeleteProjects(currentUser)}
        onProjectsChanged={refreshProjects}
      />
    </div>
  );
}
