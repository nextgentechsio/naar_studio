# Naar Studio API keys: plan

**Status (13 Nov 2026):** phases 1 and 2 are built and verified (keys, all three platforms through `/api/v1`, file uploads, usage, cap and alerts, Admin → API keys). The API reference is in `API.md`. Phase 3 has started: the billing API (`/api/v1/billing/*`, in `API.md`) is done (23 Nov 2026); the rest of phase 3 and phase 4 are not started.

Naar Studio issues its own API keys, the way Replicate and Higgsfield do. A script, an app or a client's system calls our API with a key, and we run the generation on Replicate, Higgsfield or ElevenLabs through our own provider accounts. Every run, and its cost, is tracked to the key that started it.

## Decisions

| Question | Decision |
|---|---|
| Who gets keys | Our team **and** outside clients. Each key is tied to an owner and a project. |
| Spend control | An optional **monthly cap** (USD) on each key. New runs are refused once it's reached, with alerts at 80% and 100%. |
| Pricing | **No markup.** Spend is what the platforms charge us, the same number Expenses shows today. |
| API shape | **One unified API:** `POST /api/v1/generations` for every platform, poll with `GET`, and a webhook later. |

## How it fits what we have

- Today each platform has its own start route: `/api/generate` (Replicate), `/api/higgsfield/generate` and `/api/elevenlabs/generate`. All of them need a signed-in browser session (`requireUser`).
- A run's cost is written to `expenses` when the run finishes (`recordExpense`). Each expense carries the **user** and **project** that started the run, and Dashboard and Expenses group by those.
- A run moves from "starting" to "done" when someone polls it (the browser, or the History reconcile). An API caller's own `GET` polls will move it along the same way.

The plan keeps this model and adds **one more thing to attribute spend to: the API key.**

### Who a key acts as

Every key belongs to a **user account**, and runs made with it count as that user's. Their platform access applies, and their per-user Expenses totals include it.

- **Our team:** the key belongs to the staff member.
- **A client:** we create a user account for the client. It can have login turned off, so it exists only for the API. Their spend then shows up everywhere we already report per user, and also per key.

Each key also has a **default project**, and optionally a list of other projects it may bill to. A run must name one of those projects, or it goes to the default.

## Data

New collection **`apiKeys`** (own file `lib/api-keys/db.ts`; indexes created there, like `elements`):

```
_id, name ("Acme website"), prefix ("naar_live_4fK2"), hash (SHA-256 of the full key),
userId, userName,            // who it acts as
projectIds[], defaultProjectId,
platforms[]                  // subset of replicate | higgsfield | elevenlabs
monthlyCapUsd: number|null,  // null = no cap
concurrency: number          // max runs in flight (default 5)
alerted: { month: "2026-11", at80: bool, at100: bool }
createdBy, createdAt, lastUsedAt, lastUsedIp, expiresAt|null, revokedAt|null
```

- **The key itself:** `naar_live_` plus 32 random bytes (base62). It's shown **once**, at creation. Only its SHA-256 hash is stored. The key is long and random, so a fast hash is safe and gives an indexed lookup.
- **Visible part:** the first characters (`prefix`) are kept so admins can tell keys apart.

**Additive fields on existing records** (optional, so old records and website runs don't change):

- `GenerationDoc.apiKeyId?`, `apiKeyName?`
- `ExpenseDoc.apiKeyId?`, `apiKeyName?`, copied from the generation in `recordExpense`
- Index: `expenses { apiKeyId: 1, incurredAt: -1 }` (and the same on generations)

## The API (`/api/v1/*`)

Every request sends `Authorization: Bearer naar_live_…`. No cookies are used.

| Method | Path | Does |
|---|---|---|
| `GET` | `/api/v1/models?platform=` | The models this key may run, with their input schema and a price hint |
| `POST` | `/api/v1/generations` | Start a run: `{ platform, model, input, project? }`. Returns `{ id, status }` (202) |
| `GET` | `/api/v1/generations/:id` | Status, error, `predictTime`, `costUsd`, and `output` URLs once it succeeded |
| `GET` | `/api/v1/generations/:id/output` | Streams the saved output file. Our Blob copies are never handed out directly. |
| `POST` | `/api/v1/generations/:id/cancel` | Stop a running run |
| `GET` | `/api/v1/generations?limit=&cursor=` | This key's runs, newest first |
| `GET` | `/api/v1/usage?month=2026-11` | Spend this month (or another month), the cap and what's left, plus totals by model and project |
| `GET` | `/api/v1/billing?month=` or `?from=&to=` | Billing summary: total, runs, unpriced runs, by platform, model, project and day *(phase 3, done)* |
| `GET` | `/api/v1/billing/charges` | Itemized charges (one per succeeded run), paged, filterable *(phase 3, done)* |
| `GET` | `/api/v1/billing/months?count=12` | Total for each recent month *(phase 3, done)* |
| `GET` | `/api/v1/billing/statement?format=csv\|json` | The period's statement, to keep or invoice from *(phase 3, done)* |
| `POST` | `/api/v1/files` | *(phase 2)* Upload an input image, video or audio file and get back a URL to use in `input` |

**Rules on every call:**

- **The key must be valid:** not revoked and not expired. The owner's account must be active, and the platform must be allowed both for the key and for the owner.
- **A key only sees its own runs.** Another key's run returns 404.
- **Rate limits:** each key gets 60 requests a minute, and `concurrency` caps its runs in flight (429 with `Retry-After`).
- **Errors have one shape:** `{ "error": { "code": "spend_cap_reached", "message": "…" } }`. Provider tokens and provider error details are never passed through, the same as today.
- **Logging:** `lastUsedAt` and the IP are updated at most once a minute.

### Monthly cap

- **Before a run starts:** if this month's spend plus the running runs' estimates is at or over the cap, the call is refused with **402 `spend_cap_reached`**.
  - Higgsfield gives a price quote up front, so that's the estimate.
  - Replicate and ElevenLabs costs are known only when the run ends, so the estimate is our price table's per-run figure.
- **Possible overshoot:** runs already in flight can still go over the cap by a little. The concurrency limit keeps that small. Admins see "over cap by $X", and new runs stay blocked.
- **Alerts:** the first time a key crosses 80% and 100% in a month, a notification goes to the key's owner and the admins (existing `sendNotification`). These alerts reset each month.
- **Month boundary:** the cap month is a calendar month in **UTC**, so it's the same for everyone.

## Shared code, one deliberate refactor

The logic for starting a run (validate, look up the model, call the provider, `recordGeneration`) currently lives inside the three route handlers, and they read the session cookie. To run it for an API key without copying it:

- Move each route's body into `lib/<platform>/start.ts` as `startX({ user, project, model, inputs, apiKey? })`.
- The existing routes become thin wrappers: `requireUser`, then `startX`. Their behaviour doesn't change, and the existing integration tests prove it.
- `/api/v1/generations` calls the same functions with the key's user and the key.

This is the only change to existing behaviour paths. Everything else is new files or optional fields. It touches existing code, so it's called out here for approval, per the "new features stay isolated" rule.

Also changed (small):

- `proxy.ts`: let `/api/v1/*` through without a cookie. The route checks the key itself.
- `StudioShell.tsx`: one nav item.

## Screens

**Admin → API keys** (`/admin/api-keys`, admins and the super admin):

- **List:**
  - name, owner, project, prefix (`naar_live_4fK2…`), status, last used;
  - **this month's spend against its cap** as a bar (green, then amber at 80%, red at the cap).
  - Filter by owner or status. Sort by spend or last used.
- **New key dialog:**
  - name, owner (or "New client account…"), default and allowed projects, platforms, monthly cap, concurrency and expiry;
  - then the key is shown **once**, with Copy and a "I've saved it" confirmation.
- **Key detail:**
  - daily spend chart (reusing the Dashboard's cost analytics, filtered to the key);
  - spend by model;
  - recent runs (linking to History);
  - edit the cap or limits; **Rotate** (new secret, same settings and history); **Revoke**.

**Existing pages** (small, additive):

- **History:** an "API · Acme website" badge on runs started with a key, and a "Source" filter (Website / API / one key).
- **Expenses and Dashboard:** "By API key" grouping, plus the same Source filter.

**Account:** users see the keys that act as them, with spend and cap, read only.

**API docs page** (`/developers`): a quick start with `curl` and JavaScript, every endpoint, error codes, limits, and how to upload inputs.

## Phases

1. **Keys and Replicate** — done:
   - `apiKeys` collection, key creation and hashing, bearer auth, rate and concurrency limits;
   - Replicate start refactor, `/api/v1` models, start, get, output, cancel and list;
   - tracking fields on generations and expenses, the monthly cap with alerts;
   - Admin → API keys (list, create, revoke, rotate, spend bar).
2. **All platforms** — done: Higgsfield and ElevenLabs through the same API (start refactors), `/api/v1/files` uploads, `/api/v1/usage`.
3. **Reporting:** key detail charts, History badge and Source filter, Expenses and Dashboard by key, the user's read-only list on Account, and the docs page.
4. **Webhooks:**
   - `webhook_url` on start; we POST to it when the run ends, signed with an HMAC secret per key.
   - A Vercel cron (every minute) reconciles API runs, so webhooks fire even if nobody polls.
   - Retries with backoff.

## Tests

- **Unit:** key format and hashing, cap math (month boundary in UTC, estimates, overshoot), the rate limiter, the error shape.
- **Integration** (fake providers and MongoMemoryServer; never real billable APIs):
  - **Keys and access:** create, use, revoke and rotate a key; an expired key and a disabled owner are refused; a platform or project outside the key is refused.
  - **Isolation:** one key can't see another's runs.
  - **Spend tracking:** a run started by key is recorded with `apiKeyId` on both the generation and the expense, and its cost equals the provider cost.
  - **Monthly cap:** a run is refused at the cap; the 80% and 100% alerts fire once a month.
  - **Limits:** the concurrency limit gives 429.
  - **Regression:** the existing website routes behave the same after the refactor (the full existing suite).
- **Browser:** create a key in Admin, run `curl` against the local app, and see the run and its cost on the key's bar, in History and in Expenses.

## Open points (fine to decide later)

- **Who can create keys:** admins and the super admin only in phase 1. Should users later make their own (within a cap an admin sets)?
- **Output retention:** API outputs follow the same retention as website outputs. Should clients get a longer window?
- **Monthly statement:** an exportable CSV or PDF of each client's spend, for invoicing them ourselves.
