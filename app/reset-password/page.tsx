"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import AuthCard from "@/app/components/AuthCard";
import { Alert, Button, Field, PasswordInput, Spinner } from "@/app/components/ui/primitives";

// The link's token (?token=) and whether it came from the
// welcome email (?welcome=1), read in the browser only
const noop = () => () => {};
const readSearch = () => window.location.search;

export default function ResetPasswordPage() {
  const search = useSyncExternalStore(noop, readSearch, () => "");
  const params = new URLSearchParams(search);
  const token = params.get("token") ?? "";
  const welcome = params.get("welcome") === "1";

  const [valid, setValid] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!search) return;
    let cancelled = false;
    fetch(`/api/auth/reset-password?token=${encodeURIComponent(token)}`)
      .then((response) => response.json())
      .then((data) => !cancelled && setValid(Boolean(data.valid)))
      .catch(() => !cancelled && setValid(false));
    return () => {
      cancelled = true;
    };
  }, [search, token]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("The two passwords don't match");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Couldn't set the password");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't set the password");
    } finally {
      setSubmitting(false);
    }
  }

  const title = welcome ? "Choose your password" : "Choose a new password";

  return (
    <AuthCard eyebrow={welcome ? "Welcome" : "Reset password"} title={title}>
      {done ? (
        <div className="mt-6 space-y-6">
          <Alert tone="success">Your password is set. Sign in with it now.</Alert>
          <Link href="/login" className="text-sm font-medium text-fg underline underline-offset-4">
            Go to sign in
          </Link>
        </div>
      ) : valid === null ? (
        <p className="mt-6 flex items-center gap-2 text-sm text-fg-muted">
          <Spinner /> Checking your link…
        </p>
      ) : !valid ? (
        <div className="mt-6 space-y-6">
          <Alert>This link has expired or was already used.</Alert>
          <Link href="/forgot-password" className="text-sm font-medium text-fg underline underline-offset-4">
            Ask for a new link
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <Field label="New password" hint="At least 8 characters.">
            {(control) => (
              <PasswordInput
                {...control}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                autoFocus
                required
              />
            )}
          </Field>
          <Field label="Confirm password">
            {(control) => (
              <PasswordInput
                {...control}
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            )}
          </Field>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" variant="primary" size="lg" disabled={submitting} className="w-full">
            {submitting ? (
              <>
                <Spinner /> Saving…
              </>
            ) : (
              "Set password"
            )}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
