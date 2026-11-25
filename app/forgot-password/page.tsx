"use client";

import Link from "next/link";
import { useState } from "react";
import AuthCard from "@/app/components/AuthCard";
import { Alert, Button, Field, inputClass, Spinner } from "@/app/components/ui/primitives";

export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Something went wrong");
      setSent(data.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard eyebrow="Forgot password" title="Reset your password">
      {sent ? (
        <div className="mt-6 space-y-6">
          <Alert tone="success">{sent}</Alert>
          <p className="text-sm text-fg-muted">
            No email? Check spam, or ask your admin to reset it for you.
          </p>
          <Link href="/login" className="text-sm font-medium text-fg underline underline-offset-4">
            Back to sign in
          </Link>
        </div>
      ) : (
        <>
          <p className="mt-2 text-sm text-fg-muted">
            Enter your username or email. We&apos;ll email a link to choose a new password.
          </p>
          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <Field label="Username or email">
              {(control) => (
                <input
                  {...control}
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoFocus
                  required
                  className={inputClass}
                />
              )}
            </Field>
            {error && <Alert>{error}</Alert>}
            <Button type="submit" variant="primary" size="lg" disabled={submitting} className="w-full">
              {submitting ? (
                <>
                  <Spinner /> Sending…
                </>
              ) : (
                "Email me a link"
              )}
            </Button>
            <p className="text-center text-sm">
              <Link href="/login" className="text-fg-muted underline-offset-4 hover:text-fg hover:underline">
                Back to sign in
              </Link>
            </p>
          </form>
        </>
      )}
    </AuthCard>
  );
}
