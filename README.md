# NAAR Studio

NAAR's AI generation workspace: images and video from Replicate and Higgsfield,
for every project, with every run costed and tracked.

**Version:** see `package.json` (also shown in the app's sidebar and Account page).
Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## Getting started

```bash
npm install
npm run dev     # http://localhost:3000
```

Configuration (database, provider keys, storage) lives in `.env.local`, which is never
committed.

## Project structure

```
app/
  (studio)/                 signed-in pages (one folder per route)
    _components/            app shell: layout, sidebar, providers, shared hooks
    _generate/              the Generate UI shared by Replicate and Higgsfield
    replicate/ higgsfield/  route files only (they render _generate)
    history/ elements/ dashboard/ expenses/ account/ admin/
  api/                      route handlers (server)
  components/               UI shared by every page (primitives, footer, admin tables)
  login/                    sign-in page
lib/                        server and shared logic
  auth/                     sessions, users, roles, presence, sign-in throttling
  db/                       MongoDB connection and document types
  replicate/                Replicate API, model catalog, pricing and costs
  higgsfield/               Higgsfield client (server) and its model/price list (shared)
  storage/                  saved outputs, uploads, media library, retention, video measuring
  spend/                    expense ledger and cost analytics
  client/                   browser-only helpers
  *.ts                      core domain: generations, projects, elements, app info
scripts/
  migrations/               one-off database / Blob migrations (`npm run migrate:*`)
  examples/                 API examples (`npm run higgsfield:example`)
tests/
  unit/                     pure logic
  integration/              the built app over HTTP, against fakes
data/                       static data (Replicate price table)
public/brand/               NAAR wordmarks
```

Conventions: folders starting with `_` under `app/` are private (never routes); route
folders hold the page and components only that page uses; anything used by two pages
moves up to `_components`, `_generate` or `app/components`. Server-only code stays in
`lib/` outside `lib/client/`.

## Testing

```bash
npm test                  # everything
npm run test:unit         # fast: pricing, roles, sessions, input shaping
npm run test:integration  # the built app over HTTP
```

Integration tests build the app and run it against an **in-memory MongoDB** and a
**fake Replicate API** (`tests/integration/fake-replicate.ts`), so they never touch
the real database and never spend money. Set `SKIP_BUILD=1` to reuse an existing
build. Every bug fix should come with a test that fails without it.

## Releasing

Follow the steps in [CHANGELOG.md](CHANGELOG.md#releasing-a-version): record the
changes, then `npm version patch|minor|major`.

## License

Copyright (c) 2026 NAAR. All rights reserved. Proprietary and confidential; see
[LICENSE](LICENSE).
