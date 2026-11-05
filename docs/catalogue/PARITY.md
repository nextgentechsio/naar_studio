# Catalogue: full-parity plan

**Goal:** the user asked on 2026-11-05 to make Catalogue an exact replica of the original (`ai-catalog-*` on `origin/feat/rda-catalog-migration`), built on Naar Studio's own users, projects, Blob storage and expenses.

**Detailed gap lists**, with every file and line in the original:
- [gaps/create-flow.md](gaps/create-flow.md): steps, prompt blocks, references, stored data.
- [gaps/backend-ai.md](gaps/backend-ai.md): endpoints, exact provider calls, retries, concurrency, text steps.
- [gaps/library-admin.md](gaps/library-admin.md): asset and template fields, admin pages, settings, AI helpers.
- [gaps/bulk-edit-projects-insights.md](gaps/bulk-edit-projects-insights.md): Bulk, Edit, product list, Insights.

## What stays ours (on purpose)
- **Accounts and storage:** Naar users, roles and platform access; Naar projects as cost centres; MongoDB and Vercel Blob; our expenses.
- **Image models: only the original's two**, called directly with its keys. These are Nano Banana 2.1 (`NANO_BANANA_API_KEY`, the default) and Sunburst (`OPENAI_API_KEY`). No Replicate (the user asked on 2026-11-05). Products saved with an old Replicate model map to the same model called directly (`imageModelOf`).
- **No costs on Catalogue pages.** If Insights shows cost at all, only admins see it.
- **Engine scope:** the original's **legacy engine** (`buildPrompt`) is the one we replicate. The RDA engine (scene presets, playlists, template import) depends on the Aadai Firebase snapshot and is out of scope unless that data is provided.
- **Text and vision steps:** these use Gemini (`gemini-flash-latest`) with `NANO_BANANA_API_KEY`, as the original does. Text calls are recorded as Catalogue expenses.

## Phases (each one shippable and tested)

### A. Engine correctness
Status: done (2026-11-05).
- **Google image calls:**
  - add the **`interactions`** endpoint for Nano Banana 2.1, as the legacy engine uses;
  - fix `generateContent`: skip `thought` parts, fail on block reasons, no `responseModalities`, the original safety order.
- **Retries:** Google 5 attempts (rate errors `5000×n`, transient errors `1200×n`, plus jitter). OpenAI never retried.
- **Queue:** direct runs go through a queue, 4 at once and 3 per product, instead of every shot firing in one `after()`. Timeouts: Google 180 s, OpenAI 300 s.
- **OpenAI:** quality high for the initial look, otherwise the shot's quality (default medium).
- **Busy guard** on generating the initial look (no double paid runs).
- **Reference checks:** jpeg/png/webp only, ≤50 MB, prompt ≤32000 characters.
- **Per-run trace:** final prompt, references sent, model, model version, duration. Product statuses gain `failed` and `partial`.

### B. Prompt and references, word for word
Status: prompt and references done (2026-11-05); image processing (face crop, skin depth, composites, export resize) still to do.
- Code: `lib/catalogue/prompt.ts` plus `lib/catalogue/prompt/{constants,references,blocks,types}.ts`.
- **Optional context** these files can take, not yet wired in `products.ts`:
  - `shotType` (the 13 original keys), `regenerate`;
  - `skinDepth`, `modelDescription`, `faceCropUrl`, `stylingComposites`;
  - `poseWearStyleNotes`, `poseProductCategories`, `productCategoryId`;
  - `inheritBackground`, `poseAsImage`.
- **Deviations kept for now:**
  - Feedback is appended, plus the `previous` image. This goes once refinePrompt (phase C) replaces it.
  - If a shot's own view is missing, the front photo is sent instead. This goes once front and back are required (phase C).
- **Prompt:** port `buildPrompt` blocks 1–22 verbatim, with `@imgN` tags, all 11 template variables (drop the line when one can't be filled), and no 6000-character budget.
- **References:** per-shot garment photos, no face on later shots, the original's order and ranks, packing to the cap.
- **Image processing** (sharp): face crop, skin-depth estimate with the dark-skin variants, styling composite. Outputs re-encoded to the export size (JPEG q95) plus 480 px thumbnails.

### C. Data model and create flow
- **Library:** product categories and shot types as managed entities (seeded 4 / 13). The `inactive` status, and delete = archive with restore.
- **Assets:** pose fields (style, shotTypes, wearStyleNotes, includesBackground); background fields (inputKind, categories, includesPose); accessory categories; several reference photos per model.
- **Templates:**
  - audience: genders, categories, poseStyle;
  - lifecycle: draft → Activate with the checks;
  - eligible models and accessories; `modelDescriptions` (random pick);
  - per shot: genders, categories, quality, status, pose and background pools (inherit / random), `downloadSequence`;
  - export defaults.
- **Create flow:**
  - **Details:** category and gender filter templates, models and accessories; front **and** back required; 2 extras per view; pairing ×5 and accessories ×5 with labels; pattern marking.
  - **Generation dialog** (model, size, additional details, reference image) at the initial look and again at approve.
  - **Gemini text:** `refinePrompt` for feedback, and `analyze-garment` (describeOutfit).
  - **Lock and replay:** the model, pose, background and accessories used for the initial look are locked and reused. Info modal; compare lightbox.
  - **Approve:** shot subset, pose and background overrides; "generate remaining". Upload your own initial look.

### D. Result
- **Crop** stored per shot.
- **Download** rendered to the export size and format, with a format menu, and a zip named by sequence or by shot name.
- **Regenerate:** the modal adds a model choice and a reference image. A "Change pose" picker with filters.
- **Pairing after the fact:** "Regenerate initial / all".

### E. Bulk and Edit
- **Bulk:**
  - up to 10 products sharing one setup (with a Naar project picker);
  - lazy create; queues of 3 initials and 6 remaining shots;
  - phases and buttons, lock note, custom settings per product;
  - `?from_product` reopens an existing product.
- **Edit:** 1–8 images, the `IMAGE EDIT —` wrapper, a compare slider, format and download.

### F. Products list and Insights
- **List:** server search and filters (status, category, gender, created-by for admins), paging, shot count, "Open in bulk".
- **Insights** (admin, no cost):
  - KPIs with period comparison; chart by person or by client;
  - team and templates tables, unfinished products, failures grouped by cause, CSVs;
  - a person page.

### G. Admin tools
- **Library lists:** search and filters, bulk select and archive, paging.
- **Bulk upload with review** for poses and backgrounds.
- **AI helpers:** photo → pose prompt / background prompt / wear style; background thumbnail from a prompt.
- **Debug generate:** a page for raw prompt-and-reference test runs.
- **Settings pages:** categories, shot types, generation models.

## Status log
- 2026-11-05: audits done.
- 2026-11-05: **phase A done.**
  - Google `interactions` (with the fixed `generateContent` as a fallback).
  - The database-backed call queue (`lib/catalogue/queue.ts`: 4 slots, 3 per product, leases, one safe retry).
  - OpenAI quality as in the legacy engine; the generate busy guard; reference checks; per-run traces.
- 2026-11-05: **phase B prompt port done.** Word-for-word `buildPrompt` blocks 1–22, `@imgN` tags, the original's reference order, ranks and packing. 347 tests pass.
- 2026-11-05: **approve-time shot plan (from phase C) done.** The Approve popup ("Plan the shots") sets a pose and background for each later shot and can leave shots out. Choices are sent as `shotIds` / `poseOverrides` / `backgroundOverrides`, validated, and stored on the product (`poseOverrides`, `backgroundOverrides`). They win over the template's and the product's choice. A pose or background picked when regenerating is kept for that shot, as in the original's `pose_overrides`.
- 2026-11-05: **crop (from phase D) done.** Each finished version can be cropped (Free, 3:4, 4:5, 2:3, 1:1, 9:16). The crop is stored per version as fractions on the product (`crops`), and the full image is kept. It's used for the preview, tiles and downloads, which are cropped at full resolution in the browser. References for later shots still use the full image. The initial-look preview now fits the screen, with the versions in a column beside it on desktop.
- 2026-11-05: **framing by category (ours, not in the original).**
  - Mapping: Top wear, Shirts and T-shirts are upper body (head to mid-thigh); Bottoms are lower body (chest to feet); everything else is full length.
  - A product can override it ("Framing" on Details). The choice locks once the look is approved.
  - Applies to the initial look and the front, back and side shots.
  - The ported prompt is built word for word, then its full-length lines are rewritten and a final hard rule is added (`lib/catalogue/prompt/framing.ts`). Full length leaves the prompt exactly as ported.
