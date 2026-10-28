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
