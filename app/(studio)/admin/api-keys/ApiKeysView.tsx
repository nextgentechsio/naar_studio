"use client";

import { useCallback, useEffect, useState } from "react";
import { useStudio } from "@/app/(studio)/_components/StudioProvider";
import { Icon } from "@/app/components/ui/Icon";
import { Alert, Badge, Button, cx, EmptyState, formatCost, PageHeader } from "@/app/components/ui/primitives";
import { apiKeyStatus, capState, type PublicApiKey } from "@/lib/api-keys/shared";
import { fetchApiKeys, revokeApiKey, rotateApiKey } from "@/lib/client/api-keys";
import { formatDateTime } from "@/lib/client/format";
import { errorMessage } from "@/lib/client/http";
import ApiKeyDialog from "./ApiKeyDialog";
import SecretDialog from "./SecretDialog";

// --------------------------------------------------
// ADMIN → API KEYS
//
// Keys that let scripts and clients' systems generate
// through /api/v1 as one of our accounts. Each row shows
// who the key acts as, what it may bill, and this month's
// spend against its cap.
// --------------------------------------------------

export default function ApiKeysView() {
  const { currentUser } = useStudio();
  const [keys, setKeys] = useState<PublicApiKey[] | null>(null);
  const [error, setError] = useState("");
  // undefined: closed; null: new
  const [editing, setEditing] = useState<PublicApiKey | null | undefined>(undefined);
  const [secret, setSecret] = useState<{ key: PublicApiKey; secret: string; rotated: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ id: string; action: "revoke" | "rotate" } | null>(null);

  const load = useCallback(() => {
    fetchApiKeys()
      .then((list) => {
        setKeys(list);
        setError("");
      })
      .catch((err) => {
        setKeys((now) => now ?? []);
        setError(errorMessage(err, "Couldn't load API keys."));
      });
  }, []);

  useEffect(load, [load]);

  function replace(key: PublicApiKey) {
    setKeys((now) => (now ? now.map((item) => (item.id === key.id ? key : item)) : [key]));
  }

  async function act(id: string, action: "revoke" | "rotate") {
    setBusy(id);
    setError("");
    try {
      if (action === "revoke") replace(await revokeApiKey(id));
      else {
        const result = await rotateApiKey(id);
        replace(result.key);
        setSecret({ key: result.key, secret: result.secret, rotated: true });
      }
    } catch (err) {
      setError(errorMessage(err, `Couldn't ${action} the key.`));
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  const live = (keys ?? []).filter((key) => apiKeyStatus(key) === "active");
  const monthSpend = (keys ?? []).reduce((sum, key) => sum + key.spend.amountUsd, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="API keys"
        description="Keys for scripts, apps and clients' systems to generate through the Naar Studio API. Each key acts as one account and bills one of its projects; every run and its cost is tracked to the key."
        actions={
          <Button variant="primary" icon="key" onClick={() => setEditing(null)}>
            New key
          </Button>
        }
      />

      {error && <Alert>{error}</Alert>}

      {keys && keys.length > 0 && (
        <p className="text-sm text-fg-muted">
          <span className="font-medium text-fg">{live.length}</span> active key{live.length === 1 ? "" : "s"} ·{" "}
          <span className="font-medium text-fg">{formatCost(monthSpend)}</span> spent through the API this month
        </p>
      )}

      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        {keys === null ? (
          <div className="p-10 text-center text-sm text-fg-subtle">Loading API keys…</div>
        ) : keys.length === 0 ? (
          <EmptyState
            icon="key"
            title="No API keys yet"
            description="Create a key for a script or a client. You'll see the secret once; after that only its first characters, its spend and its limits."
            action={
              <Button variant="primary" icon="key" onClick={() => setEditing(null)}>
                Create the first key
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {keys.map((key) => (
              <li key={key.id} className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,300px)_auto] lg:items-center">
                <KeyIdentity key={key.id} apiKey={key} you={key.userId === currentUser.id} />
                <SpendBar apiKey={key} />
                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  {confirming?.id === key.id ? (
                    <>
                      <span className="text-xs text-fg-muted">
                        {confirming.action === "revoke"
                          ? "Revoke? Anything using it stops at once."
                          : "Rotate? The old secret stops at once."}
                      </span>
                      <Button size="sm" variant={confirming.action === "revoke" ? "danger" : "primary"} disabled={busy === key.id} onClick={() => void act(key.id, confirming.action)}>
                        {confirming.action === "revoke" ? "Revoke" : "Rotate"}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy === key.id} onClick={() => setConfirming(null)}>
                        Cancel
                      </Button>
                    </>
                  ) : apiKeyStatus(key) === "revoked" ? (
                    <span className="text-xs text-fg-subtle">Revoked {formatDateTime(key.revokedAt!)}</span>
                  ) : (
                    <>
                      <Button size="sm" icon="edit" onClick={() => setEditing(key)}>
                        Edit
                      </Button>
                      <Button size="sm" icon="undo" title="New secret, same settings" onClick={() => setConfirming({ id: key.id, action: "rotate" })}>
                        Rotate
                      </Button>
                      <Button size="sm" variant="ghost" icon="trash" onClick={() => setConfirming({ id: key.id, action: "revoke" })}>
                        Revoke
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing !== undefined && (
        <ApiKeyDialog
          apiKey={editing}
          onSaved={(key, newSecret) => {
            if (editing) replace(key);
            else setKeys((now) => [key, ...(now ?? [])]);
            if (newSecret) setSecret({ key, secret: newSecret, rotated: false });
          }}
          onClose={() => setEditing(undefined)}
        />
      )}
      {secret && <SecretDialog apiKey={secret.key} secret={secret.secret} rotated={secret.rotated} onClose={() => setSecret(null)} />}
    </div>
  );
}

// Name, prefix, who it acts as, what it may bill, and when
// it was last used
function KeyIdentity({ apiKey: key, you }: { apiKey: PublicApiKey; you: boolean }) {
  const status = apiKeyStatus(key);
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <p className="truncate text-sm font-semibold text-fg">{key.name}</p>
        <code className="rounded bg-sunken px-1.5 py-0.5 font-mono text-[11px] text-fg-muted">{key.prefix}…</code>
        {status === "revoked" ? (
          <Badge tone="danger">Revoked</Badge>
        ) : status === "expired" ? (
          <Badge tone="warning">Expired</Badge>
        ) : key.expiresAt ? (
          <Badge tone="neutral" className="font-normal">Expires {formatDateTime(key.expiresAt)}</Badge>
        ) : null}
      </div>
      <p className="mt-1 truncate text-xs text-fg-muted">
        Acts as <span className="font-medium text-fg">{key.userName}{you ? " (you)" : ""}</span> · bills{" "}
        <span className="font-medium text-fg">{key.projects.map((project) => project.name).join(", ")}</span>
        {" · "}
        {key.platforms.join(", ")}
      </p>
      <p className="mt-1 text-[11px] text-fg-subtle">
        {key.lastUsedAt ? `Last used ${formatDateTime(key.lastUsedAt)}` : "Never used"} · {key.concurrency} run{key.concurrency === 1 ? "" : "s"} at once · created by {key.createdByName}
      </p>
    </div>
  );
}

// This month's spend against the cap: green, amber from
// 80%, red at the cap. In-flight runs are the hatched part.
function SpendBar({ apiKey: key }: { apiKey: PublicApiKey }) {
  const { spend, monthlyCapUsd: cap } = key;
  const state = capState(spend, cap);
  const total = cap ?? Math.max(spend.amountUsd + spend.inFlightUsd, 0.01);
  const billed = Math.min(100, (spend.amountUsd / total) * 100);
  const flight = Math.min(100 - billed, (spend.inFlightUsd / total) * 100);
  const tone = state === "reached" ? "bg-danger" : state === "warning" ? "bg-warning" : "bg-success";

  return (
    <div className="min-w-0" title={`${spend.count} run${spend.count === 1 ? "" : "s"} billed this month${spend.inFlight ? `, ${spend.inFlight} in flight` : ""}`}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-mono tabular-nums text-fg">
          {formatCost(spend.amountUsd)}
          {spend.inFlightUsd > 0 && <span className="text-fg-subtle"> +{formatCost(spend.inFlightUsd)}</span>}
        </span>
        <span className={cx("truncate", state === "reached" ? "font-medium text-danger" : state === "warning" ? "font-medium text-warning" : "text-fg-subtle")}>
          {cap === null ? "no cap" : state === "reached" ? `cap ${formatCost(cap)} reached` : `of ${formatCost(cap)} cap`}
        </span>
      </div>
      <div className="mt-1.5 flex h-1.5 w-full overflow-hidden rounded-full bg-sunken" role="meter" aria-valuemin={0} aria-valuemax={cap ?? undefined} aria-valuenow={spend.amountUsd} aria-label="Spend this month">
        <span className={cx("h-full", tone)} style={{ width: `${cap === null ? Math.min(100, billed) : billed}%` }} />
        {flight > 0 && <span className={cx("h-full opacity-40", tone)} style={{ width: `${flight}%` }} />}
      </div>
      <p className="mt-1 flex items-center gap-1 text-[11px] text-fg-subtle">
        <Icon name="history" size={10} />
        {spend.count} run{spend.count === 1 ? "" : "s"} this month{spend.inFlight ? ` · ${spend.inFlight} running` : ""}
      </p>
    </div>
  );
}
