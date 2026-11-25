"use client";

import { PageHeader } from "@/app/components/ui/primitives";
import ProjectBudgetsAdmin from "@/app/components/ProjectBudgetsAdmin";

export default function BudgetsView() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Budgets"
        description="Every project's total and monthly budget. Runs that would go over are refused, and everyone working in the project is told at its alert level (80% unless changed) and at 100%. Only the super admin and the budget managers they choose can change them."
      />
      <ProjectBudgetsAdmin />
    </div>
  );
}
