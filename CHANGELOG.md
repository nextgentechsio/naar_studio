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

### Changed
- Reorganised the code into folders by area (`lib/auth`, `lib/db`, `lib/replicate`,
  `lib/higgsfield`, `lib/storage`, `lib/spend`; the shared Generate UI in
  `app/(studio)/_generate`; scripts in `scripts/migrations` and `scripts/examples`).
  See the README's "Project structure".
- Copyright and version moved to a footer at the bottom of every page.

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
