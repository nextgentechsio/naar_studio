"use client";

import { useEffect, useState } from "react";
import ProjectAvatar from "@/app/components/ProjectAvatar";
import { BudgetForm, BudgetUsage } from "@/app/components/ProjectBudget";
import type { PublicProject } from "@/lib/auth/roles";
import { budgetState, type PublicProjectBudget } from "@/lib/project-budgets/shared";

// --------------------------------------------------
// BUDGETS (Admin → Budgets): every project with its
// budget and spend. Each project's budget opens under
// it and saves on its own.
// --------------------------------------------------

async function getJson(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

// Most urgent first: reached, then 80%+, then the rest
function urgency(budget: PublicProjectBudget | undefined): number {
  if (!budget) return 0;
  const states = [
    budgetState(budget.usage.totalSpentUsd, budget.usage.inFlightUsd, budget.totalUsd),
    budgetState(budget.usage.monthSpentUsd, budget.usage.inFlightUsd, budget.monthlyUsd),
  ];
  if (states.includes("reached")) return 3;
  if (states.includes("warning")) return 2;
  return budget.totalUsd !== null || budget.monthlyUsd !== null ? 1 : 0;
}

export default function ProjectBudgetsAdmin() {
  const [projects, setProjects] = useState<PublicProject[]>([]);
  const [budgets, setBudgets] = useState<Map<string, PublicProjectBudget>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getJson("/api/projects?all=1"), getJson("/api/project-budgets")])
      .then(([projectData, budgetData]) => {
        if (cancelled) return;
        setProjects((projectData.projects as PublicProject[]) ?? []);
        setBudgets(new Map(((budgetData.budgets as PublicProjectBudget[]) ?? []).map((b) => [b.projectId, b])));
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Unable to load budgets"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // Active projects first, the most urgent budgets at the top
  const sorted = [...projects].sort(
    (a, b) =>
      Number(b.status === "active") - Number(a.status === "active") ||
      urgency(budgets.get(b.id)) - urgency(budgets.get(a.id)) ||
      a.name.localeCompare(b.name)
  );
  const withBudget = projects.filter((p) => urgency(budgets.get(p.id)) > 0).length;
  const needAttention = projects.filter((p) => urgency(budgets.get(p.id)) >= 2).length;

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-fg-muted">
          {notice}
        </div>
      )}

      {!loading && projects.length > 0 && (
        <p className="text-sm text-fg-muted">
          {withBudget} of {projects.length} projects have a budget
          {needAttention > 0 && <span className="text-warning"> · {needAttention} at 80% or more</span>}
        </p>
      )}

      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        {loading ? (
          <div className="p-10 text-center text-sm text-fg-subtle">Loading budgets...</div>
        ) : !projects.length ? (
          <div className="p-10 text-center text-sm text-fg-subtle">No projects yet. Add one under Admin → Projects.</div>
        ) : (
          <div className="divide-y divide-line">
            {sorted.map((project) => {
              const budget = budgets.get(project.id);
              const open = openId === project.id;
              const hasBudget = budget && (budget.totalUsd !== null || budget.monthlyUsd !== null);
              return (
                <div key={project.id}>
                  <div className="grid items-center gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="flex min-w-0 items-center gap-3">
                      <ProjectAvatar name={project.name} imageUrl={project.imageUrl} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-fg">
                          {project.name}
                          {project.status !== "active" && <span className="ml-2 text-xs font-normal text-warning">Archived</span>}
                        </p>
                        <BudgetUsage budget={budget} />
                        {!hasBudget && !(budget && budget.usage.totalSpentUsd > 0) && (
                          <p className="mt-1 text-xs text-fg-subtle">No budget</p>
                        )}
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => {
                          setError("");
                          setNotice("");
                          setOpenId(open ? null : project.id);
                        }}
                        className={`rounded-lg border px-3 py-1.5 text-xs hover:bg-raised ${
                          open ? "border-accent text-accent" : "border-line-strong text-fg"
                        }`}
                      >
                        {hasBudget ? "Change budget" : "Set budget"}
                      </button>
                    </div>
                  </div>

                  {open && (
                    <div className="px-5 pb-5">
                      <BudgetForm
                        key={project.id}
                        project={project}
                        budget={budget}
                        onCancel={() => setOpenId(null)}
                        onSaved={(saved) => {
                          setBudgets((current) => new Map(current).set(saved.projectId, saved));
                          setOpenId(null);
                          setNotice(`Saved the budget for ${project.name}.`);
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
