"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  signOut,
  useStudio,
} from "@/app/(studio)/_components/StudioProvider";
import { Button, Field, inputClass, Spinner } from "@/app/components/ui/primitives";
import { APP_NAME, APP_COMMIT, APP_VERSION } from "@/lib/app-info";
import { ROLE_LABELS, type PublicUser } from "@/lib/auth/roles";
import { errorMessage, fetchJson } from "@/lib/client/http";

// --------------------------------------------------
// ACCOUNT
//
// Who you are, and the one thing you can change here:
// the email you can also sign in with.
// --------------------------------------------------

export default function AccountView() {
  const { currentUser } = useStudio();
  const router = useRouter();
  const [saved, setSaved] = useState<string | null>(currentUser.email);
  const [email, setEmail] = useState(currentUser.email ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function saveEmail(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const { user } = await fetchJson<{ user: PublicUser }>("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setSaved(user.email);
      setEmail(user.email ?? "");
      setNotice(user.email ? `Saved. You can now sign in with ${user.email} too.` : "Email removed.");
      // The shell's copy of the account
      router.refresh();
    } catch (err) {
      setError(errorMessage(err, "Couldn't save your email."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.2em] text-fg-subtle">
          Account
        </p>

        <h1 className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-fg sm:text-[32px]">
          Settings
        </h1>

        <p className="mt-1 text-sm text-fg-muted">Your account.</p>
      </div>

      <div className="grid max-w-xl gap-4 rounded-2xl border border-line bg-surface p-6 sm:grid-cols-3">
        {[
          ["Name", currentUser.name],
          ["Username", `@${currentUser.username}`],
          ["Role", ROLE_LABELS[currentUser.role]],
          ["Email", saved ?? "—"],
        ].map(([title, value]) => (
          <div key={title}>
            <p className="text-[10px] uppercase tracking-wider text-fg-subtle">
              {title}
            </p>

            <p className="mt-1 text-sm text-fg">{value}</p>
          </div>
        ))}
      </div>

      <section className="max-w-xl rounded-2xl border border-line bg-surface p-6" aria-labelledby="email-title">
        <h2 id="email-title" className="text-sm font-semibold text-fg">
          Email
        </h2>
        <p className="mt-1 text-sm text-fg-muted">Add your email to sign in with it instead of your username.</p>
        <form onSubmit={saveEmail} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Email" className="flex-1" error={error || undefined}>
            {(props) => (
              <input
                {...props}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className={inputClass}
              />
            )}
          </Field>
          <Button type="submit" variant="primary" disabled={saving || email.trim().toLowerCase() === (saved ?? "")}>
            {saving && <Spinner />}
            {saved && !email.trim() ? "Remove email" : "Save email"}
          </Button>
        </form>
        {notice && (
          <p role="status" className="mt-3 text-sm text-success">
            {notice}
          </p>
        )}
      </section>

      <section className="max-w-xl rounded-2xl border border-line bg-surface p-6" aria-labelledby="about-title">
        <h2 id="about-title" className="text-sm font-semibold text-fg">
          About
        </h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          {[
            ["App", APP_NAME],
            ["Version", APP_VERSION],
            ["Build", APP_COMMIT || "—"],
          ].map(([title, value]) => (
            <div key={title}>
              <dt className="text-[10px] uppercase tracking-wider text-fg-subtle">{title}</dt>
              <dd className="mt-1 font-mono text-sm text-fg">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <button
        type="button"
        onClick={signOut}
        className="rounded-xl border border-line-strong px-4 py-2 text-sm text-fg hover:bg-raised"
      >
        Sign out
      </button>
    </div>
  );
}
