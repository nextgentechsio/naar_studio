"use client";

import { useEffect, useState } from "react";
import { useStudio } from "@/app/(studio)/_components/StudioProvider";
import { Modal } from "@/app/components/ui/Modal";
import { Button, cx, Field, inputClass, Spinner } from "@/app/components/ui/primitives";
import { API_KEY_PLATFORMS, API_LIVE_PLATFORMS, DEFAULT_CONCURRENCY, MAX_CONCURRENCY, MAX_KEY_NAME, type PublicApiKey } from "@/lib/api-keys/shared";
import { canManageUser, type PublicProject, type PublicUser } from "@/lib/auth/roles";
import { platformLabel } from "@/lib/auth/platforms";
import { createApiKey, updateApiKey } from "@/lib/client/api-keys";
import { fetchActiveProjects } from "@/lib/client/data";
import { errorMessage, fetchJson } from "@/lib/client/http";

// --------------------------------------------------
// NEW / EDIT API KEY
//
// Who it acts as can't change after creation (its runs
// are already that account's); everything else can.
// --------------------------------------------------

type Form = {
  name: string;
  userId: string;
  projectIds: string[];
  platforms: string[];
  monthlyCap: string;
  concurrency: string;
  expiresAt: string;
};

function fromKey(key: PublicApiKey | null, selfId: string): Form {
  return {
    name: key?.name ?? "",
    userId: key?.userId ?? selfId,
    projectIds: key?.projects.map((project) => project.id) ?? [],
    platforms: key?.platforms ?? [...API_LIVE_PLATFORMS],
    monthlyCap: key?.monthlyCapUsd === null || key?.monthlyCapUsd === undefined ? "" : String(key.monthlyCapUsd),
    concurrency: String(key?.concurrency ?? DEFAULT_CONCURRENCY),
    expiresAt: key?.expiresAt ? key.expiresAt.slice(0, 10) : "",
  };
}

export default function ApiKeyDialog({
  apiKey: key,
  onSaved,
  onClose,
}: {
  // null: a new key
  apiKey: PublicApiKey | null;
  onSaved: (key: PublicApiKey, secret: string | null) => void;
  onClose: () => void;
}) {
  const { currentUser } = useStudio();
  const [form, setForm] = useState<Form>(() => fromKey(key, currentUser.id));
  const [users, setUsers] = useState<PublicUser[] | null>(null);
  const [projects, setProjects] = useState<PublicProject[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchJson<{ users: PublicUser[] }>("/api/users"), fetchActiveProjects()])
      .then(([data, list]) => {
        if (cancelled) return;
        setUsers(data.users);
        setProjects(list);
      })
      .catch((err) => !cancelled && setError(errorMessage(err, "Couldn't load accounts and projects.")));
    return () => {
      cancelled = true;
    };
  }, []);

  // Accounts the key may act as: the manager themselves,
  // and the accounts they manage (active ones)
  const owners = (users ?? []).filter((user) => !user.disabled && (user.id === currentUser.id || canManageUser(currentUser, user)));
  const owner = owners.find((user) => user.id === form.userId) ?? (users ?? []).find((user) => user.id === form.userId);

  const set = <K extends keyof Form>(field: K, value: Form[K]) => setForm((now) => ({ ...now, [field]: value }));
  const toggle = (field: "projectIds" | "platforms", value: string) =>
    setForm((now) => ({ ...now, [field]: now[field].includes(value) ? now[field].filter((item) => item !== value) : [...now[field], value] }));

  async function save(close: () => void) {
    setSaving(true);
    setError("");
    const cap = form.monthlyCap.trim() === "" ? null : Number(form.monthlyCap);
    const fields = {
      name: form.name.trim(),
      userId: form.userId,
      projectIds: form.projectIds,
      platforms: form.platforms,
      monthlyCapUsd: cap !== null && Number.isNaN(cap) ? -1 : cap,
      concurrency: Number(form.concurrency),
      expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59`).toISOString() : null,
    };
    try {
      if (key) {
        onSaved(await updateApiKey(key.id, fields), null);
      } else {
        const result = await createApiKey(fields);
        onSaved(result.key, result.secret);
      }
      close();
    } catch (err) {
      setError(errorMessage(err, "Couldn't save the key."));
    } finally {
      setSaving(false);
    }
  }

  const ready = users !== null && projects !== null;

  return (
    <Modal
      title={key ? `Edit "${key.name}"` : "New API key"}
      subtitle={key ? "Its runs so far stay as they are." : "The secret is shown once, after you save."}
      size="lg"
      onClose={onClose}
    >
      {(close) => (
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void save(close);
          }}
        >
          <div className="min-h-0 space-y-4 overflow-y-auto px-5 pb-4 pt-1">
            <Field label="Name" required hint="What it's for: a script, an app, a client.">
              {(props) => (
                <input
                  {...props}
                  value={form.name}
                  onChange={(event) => set("name", event.target.value)}
                  maxLength={MAX_KEY_NAME}
                  placeholder="e.g. Acme website"
                  required
                  autoFocus
                  className={inputClass}
                />
              )}
            </Field>

            <Field
              label="Acts as"
              required
              hint={key ? "Can't change: the key's runs are this account's." : "Runs and spend count as this account's. For a client, make them an account first."}
            >
              {(props) =>
                key ? (
                  <p id={props.id} className="text-sm text-fg">
                    {key.userName}
                  </p>
                ) : (
                  <select {...props} value={form.userId} onChange={(event) => set("userId", event.target.value)} className={inputClass} disabled={!ready}>
                    {owners.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                        {user.id === currentUser.id ? " (you)" : ""} · {user.username}
                      </option>
                    ))}
                  </select>
                )
              }
            </Field>

            <Field label="Projects it may bill" required hint="The first picked is the default when a call names none.">
              {(props) => (
                <div id={props.id} role="group" className="flex flex-wrap gap-1.5">
                  {(projects ?? []).map((project) => {
                    const on = form.projectIds.includes(project.id);
                    const order = form.projectIds.indexOf(project.id);
                    return (
                      <button
                        key={project.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggle("projectIds", project.id)}
                        className={cx(
                          "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                          on ? "border-accent bg-accent-soft text-accent" : "border-line text-fg-muted hover:border-line-strong hover:text-fg"
                        )}
                      >
                        {order === 0 && "★ "}
                        {project.name}
                      </button>
                    );
                  })}
                  {projects && projects.length === 0 && <span className="text-xs text-fg-subtle">No active projects. Add one under Admin → Projects.</span>}
                </div>
              )}
            </Field>

            <Field label="Platforms" required hint={owner ? `Only ones ${owner.name} has access to can be picked.` : undefined}>
              {(props) => (
                <div id={props.id} role="group" className="flex flex-wrap gap-1.5">
                  {API_KEY_PLATFORMS.map((platform) => {
                    const on = form.platforms.includes(platform);
                    const allowed = !owner || owner.platforms.includes(platform);
                    return (
                      <button
                        key={platform}
                        type="button"
                        aria-pressed={on}
                        disabled={!allowed}
                        title={!allowed ? `${owner?.name} doesn't have ${platformLabel(platform)}` : undefined}
                        onClick={() => toggle("platforms", platform)}
                        className={cx(
                          "rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                          on ? "border-accent bg-accent-soft text-accent" : "border-line text-fg-muted hover:border-line-strong hover:text-fg"
                        )}
                      >
                        {platformLabel(platform)}
                      </button>
                    );
                  })}
                </div>
              )}
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Monthly cap (USD)" hint="Empty: no cap. Runs are refused at the cap; alerts at 80% and 100%.">
                {(props) => (
                  <input
                    {...props}
                    type="number"
                    min={0.01}
                    step={0.01}
                    inputMode="decimal"
                    value={form.monthlyCap}
                    onChange={(event) => set("monthlyCap", event.target.value)}
                    placeholder="No cap"
                    className={inputClass}
                  />
                )}
              </Field>
              <Field label="Runs at once" hint={`1 to ${MAX_CONCURRENCY}.`}>
                {(props) => (
                  <input
                    {...props}
                    type="number"
                    min={1}
                    max={MAX_CONCURRENCY}
                    step={1}
                    value={form.concurrency}
                    onChange={(event) => set("concurrency", event.target.value)}
                    className={inputClass}
                  />
                )}
              </Field>
              <Field label="Expires" hint="Empty: never.">
                {(props) => <input {...props} type="date" value={form.expiresAt} onChange={(event) => set("expiresAt", event.target.value)} className={inputClass} />}
              </Field>
            </div>

            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <Button onClick={close} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" icon={saving ? undefined : key ? "check" : "key"} disabled={saving || !ready}>
              {saving && <Spinner />}
              {key ? "Save changes" : "Create key"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
