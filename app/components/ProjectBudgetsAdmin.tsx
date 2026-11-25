"use client";

import { useEffect, useState } from "react";
import ProjectAvatar from "@/app/components/ProjectAvatar";
import { BudgetForm, BudgetUsage } from "@/app/components/ProjectBudget";
import type { PublicProject } from "@/lib/auth/roles";
import { budgetState, type PublicProjectBudget } from "@/lib/project-budgets/shared";

type Manager = { id: string; name: string; username: string };

// --------------------------------------------------
// BUDGETS (Admin → Budgets): every project with its
// budget and spend. Only the budget managers (chosen by
// the super admin) set or change budgets: each project's
// opens under it and saves on its own. Everyone else here
// sees them only.
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
  const [managers, setManagers] = useState<Manager[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  // Only for the super admin: who they can choose from
  const [candidates, setCandidates] = useState<Manager[] | null>(null);
  const [choosing, setChoosing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getJson("/api/projects?all=1"), getJson("/api/project-budgets")])
      .then(([projectData, budgetData]) => {
        if (cancelled) return;
        setProjects((projectData.projects as PublicProject[]) ?? []);
        setBudgets(new Map(((budgetData.budgets as PublicProjectBudget[]) ?? []).map((b) => [b.projectId, b])));
        setManagers((budgetData.managers as Manager[]) ?? []);
        setCanEdit(Boolean(budgetData.canEdit));
        setCandidates((budgetData.candidates as Manager[] | undefined) ?? null);
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

      {!loading && (
        <ManagersBar
          managers={managers}
          canEdit={canEdit}
          candidates={candidates}
          choosing={choosing}
          onChoose={() => {
            setError("");
            setNotice("");
            setChoosing(!choosing);
          }}
          onSaved={(saved) => {
            setManagers(saved);
            setChoosing(false);
            setNotice(saved.length ? "Saved the budget managers." : "Removed the budget managers: no one can change budgets now.");
          }}
        />
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
                    {canEdit && (
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
                    )}
                  </div>

                  {open && canEdit && (
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

// Who may change budgets; the super admin chooses them
function ManagersBar({
  managers,
  canEdit,
  candidates,
  choosing,
  onChoose,
  onSaved,
}: {
  managers: Manager[];
  canEdit: boolean;
  candidates: Manager[] | null;
  choosing: boolean;
  onChoose: () => void;
  onSaved: (managers: Manager[]) => void;
}) {
  const names = managers.map((manager) => manager.name).join(", ");
  return (
    <div className="rounded-2xl border border-line bg-surface px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg">Budget managers</p>
          <p className="mt-1 text-xs text-fg-subtle">
            {managers.length
              ? `${names} ${managers.length === 1 ? "is the only person who" : "are the only people who"} can set and change budgets.`
              : "No one yet. Until the super admin chooses a budget manager, budgets can't be set or changed."}
            {canEdit && " That includes you."}
            {!canEdit && managers.length > 0 && " You can see budgets here, but not change them."}
          </p>
        </div>
        {candidates && (
          <button
            type="button"
            aria-expanded={choosing}
            onClick={onChoose}
            className={`rounded-lg border px-3 py-1.5 text-xs hover:bg-raised ${
              choosing ? "border-accent text-accent" : "border-line-strong text-fg"
            }`}
          >
            {managers.length ? "Change managers" : "Choose a manager"}
          </button>
        )}
      </div>
      {choosing && candidates && (
        <ManagersForm candidates={candidates} current={managers} onSaved={onSaved} onCancel={onChoose} />
      )}
    </div>
  );
}

function ManagersForm({
  candidates,
  current,
  onSaved,
  onCancel,
}: {
  candidates: Manager[];
  current: Manager[];
  onSaved: (managers: Manager[]) => void;
  onCancel: () => void;
}) {
  const [chosen, setChosen] = useState(() => new Set(current.map((manager) => manager.id)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/project-budgets/managers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: [...chosen] }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Save failed (${response.status})`);
      onSaved(data.managers as Manager[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="mt-4 space-y-4 border-t border-line pt-4">
      <fieldset>
        <legend className="text-sm text-fg">Who can set and change budgets?</legend>
        <p className="mt-1 text-xs text-fg-subtle">
          Choose from the admins. Not even the super admin can change budgets without being chosen.
        </p>
        {candidates.length ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {candidates.map((candidate) => (
              <label
                key={candidate.id}
                className="flex cursor-pointer items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-sm hover:bg-raised"
              >
                <input
                  type="checkbox"
                  checked={chosen.has(candidate.id)}
                  onChange={(event) =>
                    setChosen((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(candidate.id);
                      else next.delete(candidate.id);
                      return next;
                    })
                  }
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                <span className="min-w-0">
                  <span className="block truncate text-fg">{candidate.name}</span>
                  <span className="block truncate text-xs text-fg-subtle">@{candidate.username}</span>
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-fg-muted">There are no active admins yet. Add one under Admin &rarr; Users first.</p>
        )}
      </fieldset>
      {error && (
        <div role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:bg-raised disabled:text-fg-subtle"
        >
          {saving ? "Saving..." : "Save managers"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-line-strong px-4 py-2 text-sm text-fg hover:bg-raised"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
