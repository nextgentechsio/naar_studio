"use client";

import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { PasswordInput } from "@/app/components/ui/primitives";
import { formatLastSeen } from "@/lib/auth/presence";
import {
  assignableRoles,
  canManageUser,
  ROLE_LABELS,
  type PublicUser,
  type Role,
} from "@/lib/auth/roles";

// --------------------------------------------------
// USER MANAGEMENT (super_admin + admin)
//
// Controls are hidden based on lib/auth/roles.ts, but every
// action is re-checked by /api/users on the server.
// --------------------------------------------------

type FormState = {
  mode: "create" | "edit";
  id?: string;
  username: string;
  name: string;
  role: Role;
  password: string;
};

const inputClass =
  "h-11 w-full rounded-xl border border-line bg-sunken px-3 text-sm outline-none focus:border-accent disabled:text-fg-subtle";

async function callApi(
  url: string,
  init?: RequestInit
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      (data as { error?: string }).error ||
        `Request failed (${response.status})`
    );
  }

  return data;
}

export default function UsersAdmin({
  currentUser,
}: {
  currentUser: PublicUser;
}) {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState<FormState | null>(null);

  const roleOptions = assignableRoles(currentUser);

  // Online status: super admin only (the API only sends
  // it to them, too)
  const showPresence = currentUser.role === "super_admin";
  const now = useMinuteClock();

  // `loading` starts true; reloads after edits refresh
  // in place without flashing the loading state.
  const loadUsers = useCallback(async () => {
    try {
      const data = await callApi("/api/users");
      setUsers((data.users as PublicUser[]) ?? []);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load users"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load (state is only set in the callbacks)
  useEffect(() => {
    let cancelled = false;

    callApi("/api/users")
      .then((data) => {
        if (!cancelled) {
          setUsers((data.users as PublicUser[]) ?? []);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load users"
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Keep online status fresh while the page is open
  useEffect(() => {
    if (!showPresence) return;

    const timer = setInterval(() => {
      if (document.visibilityState === "visible") loadUsers();
    }, PRESENCE_REFRESH_MS);

    return () => clearInterval(timer);
  }, [showPresence, loadUsers]);

  // You're looking at this page, so you're online (your
  // first heartbeat may land after the list loads)
  const isOnline = (user: PublicUser) =>
    user.id === currentUser.id || Boolean(user.presence?.online);

  const onlineCount = users.filter(isOnline).length;

  function openCreate() {
    setError("");
    setNotice("");
    setForm({
      mode: "create",
      username: "",
      name: "",
      role: "user",
      password: "",
    });
  }

  function openEdit(user: PublicUser) {
    setError("");
    setNotice("");
    setForm({
      mode: "edit",
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      password: "",
    });
  }

  async function submitForm(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!form) return;

    setError("");
    setNotice("");
    setSaving(true);

    try {
      if (form.mode === "create") {
        await callApi("/api/users", {
          method: "POST",
          body: JSON.stringify({
            username: form.username,
            name: form.name,
            role: form.role,
            password: form.password,
          }),
        });

        setNotice(`Created ${form.username}.`);
      } else {
        await callApi(`/api/users/${form.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: form.name,
            role: form.role,
            // Blank means "keep the current password"
            ...(form.password
              ? { password: form.password }
              : {}),
          }),
        });

        setNotice(`Updated ${form.username}.`);
      }

      setForm(null);
      await loadUsers();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Save failed"
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleDisabled(user: PublicUser) {
    setError("");
    setNotice("");

    try {
      await callApi(`/api/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          disabled: !user.disabled,
        }),
      });

      setNotice(
        `${user.username} ${
          user.disabled ? "enabled" : "disabled"
        }.`
      );
      await loadUsers();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Update failed"
      );
    }
  }

  async function removeUser(user: PublicUser) {
    if (
      !window.confirm(
        `Delete ${user.username}? This cannot be undone.`
      )
    ) {
      return;
    }

    setError("");
    setNotice("");

    try {
      await callApi(`/api/users/${user.id}`, {
        method: "DELETE",
      });

      setNotice(`Deleted ${user.username}.`);
      await loadUsers();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Delete failed"
      );
    }
  }

  const editingSelf =
    form?.mode === "edit" && form.id === currentUser.id;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-fg-muted">
            {currentUser.role === "super_admin"
              ? "Use Edit on your own row to change your name or password."
              : "You can manage accounts with the User role."}
          </p>

          {showPresence && !loading && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-fg-muted"
              aria-live="polite"
            >
              <span
                aria-hidden
                className={`h-2 w-2 rounded-full ${onlineCount ? "bg-success" : "bg-line-strong"}`}
              />
              {onlineCount} online now
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={openCreate}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-hover"
        >
          Add user
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {notice && (
        <div className="rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
          {notice}
        </div>
      )}

      {form && (
        <form
          onSubmit={submitForm}
          className="space-y-5 rounded-2xl border border-line bg-surface p-5"
        >
          <h2 className="font-semibold">
            {form.mode === "create"
              ? "New user"
              : `Edit ${form.username}`}
          </h2>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block space-y-2">
              <span className="block text-sm text-fg">
                Username
              </span>

              <input
                value={form.username}
                onChange={(event) =>
                  setForm({
                    ...form,
                    username: event.target.value,
                  })
                }
                disabled={form.mode === "edit"}
                required
                autoComplete="off"
                placeholder="e.g. sabina"
                className={inputClass}
              />
            </label>

            <label className="block space-y-2">
              <span className="block text-sm text-fg">
                Display name
              </span>

              <input
                value={form.name}
                onChange={(event) =>
                  setForm({
                    ...form,
                    name: event.target.value,
                  })
                }
                required
                autoComplete="off"
                placeholder="e.g. Sabina"
                className={inputClass}
              />
            </label>

            <label className="block space-y-2">
              <span className="block text-sm text-fg">
                Role
              </span>

              <select
                value={form.role}
                onChange={(event) =>
                  setForm({
                    ...form,
                    role: event.target.value as Role,
                  })
                }
                disabled={editingSelf}
                className={inputClass}
              >
                {/* Keep the current role visible even if
                    this actor can't assign it */}
                {(roleOptions.includes(form.role)
                  ? roleOptions
                  : [form.role, ...roleOptions]
                ).map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-2">
              <span className="block text-sm text-fg">
                {form.mode === "create"
                  ? "Password"
                  : "New password"}
              </span>

              <PasswordInput
                baseClassName={inputClass}
                value={form.password}
                onChange={(event) =>
                  setForm({
                    ...form,
                    password: event.target.value,
                  })
                }
                required={form.mode === "create"}
                minLength={8}
                autoComplete="new-password"
                placeholder={
                  form.mode === "create"
                    ? "At least 8 characters"
                    : "Leave blank to keep current"
                }
              />
            </label>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:bg-raised disabled:text-fg-subtle"
            >
              {saving ? "Saving..." : "Save"}
            </button>

            <button
              type="button"
              onClick={() => setForm(null)}
              className="rounded-xl border border-line-strong px-4 py-2 text-sm text-fg hover:bg-raised"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        {loading ? (
          <div className="p-10 text-center text-sm text-fg-subtle">
            Loading users...
          </div>
        ) : !users.length ? (
          <div className="p-10 text-center text-sm text-fg-subtle">
            No users.
          </div>
        ) : (
          <div className="divide-y divide-line">
            {users.map((user) => {
              const isSelf = user.id === currentUser.id;
              // Self: name and password only (the server
              // blocks role/disable/delete on yourself)
              const manageable =
                isSelf ||
                canManageUser(currentUser, user);

              return (
                <div
                  key={user.id}
                  className="grid items-center gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_120px_90px_220px]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {showPresence && (
                      <UserAvatar
                        name={user.name}
                        online={isOnline(user)}
                      />
                    )}

                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fg">
                        {user.name}
                        {isSelf && (
                          <span className="ml-2 text-xs text-fg-muted">
                            (you)
                          </span>
                        )}
                      </p>

                      <p className="mt-1 truncate text-xs text-fg-subtle">
                        @{user.username}
                        {showPresence && user.presence && (
                          <>
                            {" · "}
                            {isOnline(user) ? (
                              <span className="font-medium text-success">
                                Online now
                              </span>
                            ) : now ? (
                              formatLastSeen(user.presence.lastSeenAt, now)
                            ) : null}
                          </>
                        )}
                      </p>
                    </div>
                  </div>

                  <span className="text-xs text-fg-muted">
                    {ROLE_LABELS[user.role]}
                  </span>

                  <span
                    className={`text-xs ${
                      user.disabled
                        ? "font-medium text-danger"
                        : "text-fg-muted"
                    }`}
                  >
                    {user.disabled ? "Disabled" : "Active"}
                  </span>

                  <div className="flex flex-wrap justify-end gap-2">
                    {manageable && (
                      <button
                        type="button"
                        onClick={() => openEdit(user)}
                        className="rounded-lg border border-line-strong px-3 py-1.5 text-xs text-fg hover:bg-raised"
                      >
                        Edit
                      </button>
                    )}

                    {manageable && !isSelf && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            toggleDisabled(user)
                          }
                          className="rounded-lg border border-line-strong px-3 py-1.5 text-xs text-fg hover:bg-raised"
                        >
                          {user.disabled
                            ? "Enable"
                            : "Disable"}
                        </button>

                        <button
                          type="button"
                          onClick={() => removeUser(user)}
                          className="rounded-lg border border-danger/40 px-3 py-1.5 text-xs text-danger hover:bg-danger/15"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const PRESENCE_REFRESH_MS = 30_000;

// Current time, updated each minute, browser-only (null
// during the server render), for "Last seen 5 min ago"
function subscribeMinute(onChange: () => void) {
  const timer = setInterval(onChange, 60_000);
  return () => clearInterval(timer);
}

function useMinuteClock(): number | null {
  const minute = useSyncExternalStore(
    subscribeMinute,
    () => Math.floor(Date.now() / 60_000),
    () => null
  );

  return minute === null ? null : minute * 60_000;
}

function UserAvatar({ name, online }: { name: string; online: boolean }) {
  return (
    <span className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-raised text-xs font-semibold text-fg">
      {name.charAt(0).toUpperCase() || "?"}
      <span
        className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface ${
          online ? "bg-success" : "bg-line-strong"
        }`}
        role="img"
        aria-label={online ? "Online" : "Offline"}
      />
    </span>
  );
}
