# Changelog

All notable changes to NAAR Studio. Versions follow [Semantic Versioning](https://semver.org):
**major** for changes that break how people work or what other systems rely on, **minor**
for new features, **patch** for fixes.

## Releasing a version

1. Move the items under **Unreleased** into a new section with the version and date.
2. Run `npm version patch` (or `minor` / `major`). This updates `package.json` and
   `package-lock.json`, commits, and tags `vX.Y.Z`.
3. Push with the tag (`git push --follow-tags`) and deploy.

The app shows its version and build in the sidebar and on the Account page
(`lib/app-info.ts`; the build reads it from `package.json`).

## [Unreleased]

### Added
- ElevenLabs as a third platform (its own page): text to speech, sound effects, music
  and voice changer, with every run saved, costed from ElevenLabs' API prices, and
  counted in History, Expenses and the Dashboard. Needs `ELEVENLABS_API_KEY`.
- Elements hold reference videos and voice clips as well as images (at least one file
  in all). Mentioning one with @ puts each file in the model's matching input, e.g.
  Seedance's reference images, videos and audio.
- "Add to element" on generated images, videos and audio (Generate page and History):
  copies the result into your library and adds it to an existing element or starts a
  new one.
- "Save to library" on generated images, videos and audio (Generate page and History),
  to pick them again as inputs in later runs.
- An "Outputs" tab in the upload window: pick any of your past results of the field's
  type straight into an input (copied into your library as it's added).
- Reorder the files in an input that takes several (images, videos, audio): drag one
  onto another's place, or Alt + arrow keys. Each shows its number, the order the
  model gets them in.
- Dashboard: Spend by model, project and person and Cost per model list every item
  (no more "Other" row or 10-model cap), scrolling inside their card.

### Changed
- Reorganised the code into folders by area (`lib/auth`, `lib/db`, `lib/replicate`,
  `lib/higgsfield`, `lib/storage`, `lib/spend`; the shared Generate UI in
  `app/(studio)/_generate`; scripts in `scripts/migrations` and `scripts/examples`).
  See the README's "Project structure".
- Copyright and version moved to a footer at the bottom of every page.
- Dashboard uses its space better: two-line bar rows (details beside the name),
  Cost per model in two columns on wide screens, the four totals as a 2×2 grid on
  phones, and filters that stay on one line.
- Rich white background in the light theme (no green tint).

### Removed
- Unused code, the unused `replicate` package, default Next.js images and two old
  output images no record points to.

## [1.0.0] - 2026-10-28

First versioned release.

### Generate
- Replicate and Higgsfield models, with project-based runs, cost estimates and exact
  Higgsfield quotes where available.
- Draft (480p) runs for Higgsfield video models.
- Upload / Library popup: uploads are kept per user in a media library for reuse.
- Elements: saved characters and objects, added to a prompt with `@`.
- Seedance input videos are resized and checked (size and length) before a run.
- Switch from Reference to video to Video edit, keeping files and prompt.
- Size, length and file size shown for every image and video.

### History
- Filters by project, model, person, status, prompt and created date.
- Super admin: hide runs from everyone else, and delete runs (with their expense).

### Spend
- Expense ledger for every billed run, with metered Higgsfield costs measured from
  the actual files.
- Expenses: filters by platform, project, model, person and date; numbered pages.
- Dashboard: spend per day by platform, breakdowns by model, project and person,
  cost per model, most expensive runs, success rate and a month-end forecast.

### App
- NAAR Studio name, version and copyright shown in the app.
