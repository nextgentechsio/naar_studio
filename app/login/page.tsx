"use client";

import { useState, useSyncExternalStore } from "react";
import ThemeToggle from "@/app/components/ThemeToggle";
import { NaarLogo } from "@/app/components/ui/NaarLogo";
import { safeNextPath } from "@/lib/safe-next";
import {
  Alert,
  Button,
  eyebrowClass,
  Field,
  inputClass,
  PasswordInput,
  Spinner,
} from "@/app/components/ui/primitives";

// Why the user landed here (?reason=), read in the
// browser only so the static page needs no Suspense
const noop = () => () => {};
const readReason = () =>
  new URLSearchParams(window.location.search).get("reason");

export default function LoginPage() {
  const reason = useSyncExternalStore(noop, readReason, () => null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await response
        .json()
        .catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Login failed");
      }

      window.location.assign(
        safeNextPath(
          new URLSearchParams(window.location.search).get("next"),
          window.location.origin
        )
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Login failed"
      );
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen text-fg lg:grid-cols-[1.1fr_1fr]">
      {/* BRAND PANEL (desktop): NAAR black, like the about.naar.io hero */}
      <section className="relative hidden flex-col justify-between overflow-hidden bg-[#0d0d0d] p-12 text-[#f4f4f3] lg:flex">
        <NaarLogo height={30} className="text-white" />

        <div className="max-w-md">
          <p className="mb-5 text-[11px] font-medium uppercase tracking-[0.3em] text-[#b8b8b6]">
            Naar Studio
          </p>

          <h1 className="text-5xl font-bold leading-[1.05] tracking-[-0.03em]">
            Create with Naar.
            <br />
            <span className="text-[#2fd6c8]">Spend</span> with
            purpose.
          </h1>

          <p className="mt-6 text-base leading-7 text-[#b8b8b6]">
            Generate images and video for every project,
            with every run costed and tracked.
          </p>
        </div>

        <p className="text-xs text-[#959593]">
          Internal workspace · Naar
        </p>
      </section>

      {/* SIGN-IN FORM */}
      <section className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-10 flex items-center gap-2 lg:hidden">
            <NaarLogo height={26} />
            <span className="pt-0.5 text-[15px] font-medium text-fg-muted">
              Studio
            </span>
          </div>

          <p className={eyebrowClass}>Welcome back</p>

          <h2 className="mt-2 text-[28px] font-bold leading-tight tracking-[-0.02em]">
            Sign in to Naar Studio
          </h2>

          <p className="mt-2 text-sm text-fg-muted">
            Use the username and password from your admin.
          </p>

          <form
            onSubmit={handleSubmit}
            className="mt-8 space-y-5"
            noValidate={false}
          >
            <Field label="Username">
              {(control) => (
                <input
                  {...control}
                  value={username}
                  onChange={(event) =>
                    setUsername(event.target.value)
                  }
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoFocus
                  required
                  className={inputClass}
                />
              )}
            </Field>

            <Field label="Password">
              {(control) => (
                <PasswordInput
                  {...control}
                  value={password}
                  onChange={(event) =>
                    setPassword(event.target.value)
                  }
                  autoComplete="current-password"
                  required
                />
              )}
            </Field>

            {reason === "replaced" && !error && (
              <Alert tone="warning">
                You were signed out because your account signed in on
                another device. Only one session per account is allowed.
              </Alert>
            )}

            {reason === "ended" && !error && (
              <Alert tone="warning">
                Your session has ended. Please sign in again.
              </Alert>
            )}

            {error && <Alert>{error}</Alert>}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={submitting}
              className="w-full"
            >
              {submitting ? (
                <>
                  <Spinner /> Signing in…
                </>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>

          <div className="mt-8 flex justify-center">
            <ThemeToggle />
          </div>
        </div>
      </section>
    </main>
  );
}
