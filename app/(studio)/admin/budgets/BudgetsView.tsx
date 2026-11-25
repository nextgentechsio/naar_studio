"use client";

import { PageHeader } from "@/app/components/ui/primitives";
import ProjectBudgetsAdmin from "@/app/components/ProjectBudgetsAdmin";

export default function BudgetsView() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Budgets"
        description="Set a total and/or monthly budget for each project. Runs that would go over are refused, and everyone working in the project is told at 80% and 100%."
      />
      <ProjectBudgetsAdmin />
    </div>
  );
}
