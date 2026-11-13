# Naar Studio API (v1)

Generate through Naar Studio with an API key. Every call sends the key as a bearer token:

```
Authorization: Bearer naar_live_…
```

Keys are created by an admin under **Admin → API keys**. A key acts as one account, bills one of its projects, and may have a monthly spend cap.

## Start a generation

```
POST /api/v1/generations
{
  "model": "google/nano-banana",
  "input": { "prompt": "a red bicycle" },
  "project": "Acme spring campaign"      // optional: name or id; the key's default when absent
}
```

`202 Accepted` with the generation. `platform` is `replicate` (the default), `higgsfield` or `elevenlabs`; the key must have that platform.

- **Replicate:** any public model id (`owner/name`). `GET /api/v1/models?platform=replicate` lists the ones with a known price; `?model=owner/name` gives a model's input schema.
- **Higgsfield:** `GET /api/v1/models?platform=higgsfield` lists every model (video, image, audio) with a price hint; `&model=<id>` gives its inputs. Models that quote a price count that quote towards the cap while running.
- **ElevenLabs:** `GET /api/v1/models?platform=elevenlabs` lists text to speech, sound effects, music and voice changer; `&model=tts/eleven_multilingual_v2` gives its inputs, including the account's voices. Input `prompt` is the text or description; text to speech and voice changer need `voice_id`.

`GET /api/v1/models` with no platform lists everything the key may run.

## Upload an input file

```
POST /api/v1/files          (multipart/form-data, field "file")
→ 201 { "object": "file", "url": "https://…", "contentType": "image/png", "size": 48213, "expiresInDays": 7 }
```

Image, video or audio, up to 100 MB. Use `url` in a generation's input (`image_input`, `image_url`, `audio_url`, …). Files are kept for the same period as outputs, so upload shortly before you use them. When the app runs on Vercel, uploads through this endpoint are limited to about 4.5 MB by the platform; for larger files pass a public URL of your own in the input instead.

## A generation

```
{
  "id": "…",
  "object": "generation",
  "platform": "replicate",
  "model": "google/nano-banana",
  "project": { "id": "…", "name": "Acme spring campaign" },
  "status": "succeeded",            // starting | processing | succeeded | failed | canceled
  "error": null,
  "input": { "prompt": "a red bicycle" },
  "output": { "url": "https://…/api/v1/generations/<id>/output", "contentType": "image/png" },
  "runTime": 4.2,                   // seconds
  "costUsd": 0.039,
  "createdAt": "2026-11-13T15:22:10.000Z",
  "completedAt": "2026-11-13T15:22:15.000Z"
}
```

- `GET /api/v1/generations/:id` — poll until `status` is `succeeded`, `failed` or `canceled`. Polling is what moves a run along, so poll every couple of seconds. `output` appears once the file is saved (a run can read `processing` for a moment after the model is done).
- `GET /api/v1/generations/:id/output` — the file, with the same bearer header. Range requests work.
- `POST /api/v1/generations/:id/cancel` — stop a running run.
- `GET /api/v1/generations?limit=20&cursor=…&status=succeeded` — the key's runs, newest first; pass `nextCursor` back for the next page.

## Usage

`GET /api/v1/usage?month=2026-11` (this month by default):

```
{
  "object": "usage",
  "key": { "id": "…", "name": "Acme website" },
  "month": "2026-11",
  "spentUsd": 12.4, "runs": 318,
  "inFlight": { "runs": 2, "estimatedUsd": 0.08 },
  "cap": { "monthlyUsd": 25, "remainingUsd": 12.52, "state": "ok" },   // null when the key has no cap
  "concurrency": 5,
  "byModel": [ { "id": "google/nano-banana", "name": "google/nano-banana", "amountUsd": 12.4, "count": 318 } ],
  "byProject": [ { "id": "…", "name": "Acme spring campaign", "amountUsd": 12.4, "count": 318 } ]
}
```

Spend is what the platform charges, with no markup. Months are calendar months in UTC.

## Limits

- **Monthly cap:** when billed spend plus the estimated cost of runs in flight reaches the key's cap, a start is refused with `402 spend_cap_reached`. The key's owner and the admins are notified at 80% and at 100%.
- **Runs at once:** past the key's limit a start gets `429 too_many_runs` with `Retry-After`.
- **Requests:** 60 a minute per key, `429 rate_limited` with `Retry-After` beyond that.

## Errors

Every error has one shape:

```
{ "error": { "code": "spend_cap_reached", "message": "…" } }
```

| Status | Code | Meaning |
|---|---|---|
| 400 | `invalid_request`, `invalid_json`, `platform_unavailable` | Something in the request |
| 401 | `missing_api_key`, `invalid_api_key`, `expired_api_key`, `revoked_api_key` | The key |
| 402 | `spend_cap_reached`, `provider_credits` | The key's monthly cap; the platform account is out of credits |
| 403 | `platform_not_allowed`, `project_not_allowed`, `account_disabled` | What the key may do |
| 404 | `not_found`, `output_not_found`, `model_not_found` | Nothing with that id for this key |
| 409 | `project_archived`, `already_finished` | State |
| 413 | `body_too_large` | Over 200 KB |
| 422 | `invalid_input` | The model rejected the input |
| 429 | `rate_limited`, `too_many_runs` | Slow down (see `Retry-After`) |
| 5xx | `provider_error`, `server_error` | Try again |

Provider error details and tokens are never passed through.
