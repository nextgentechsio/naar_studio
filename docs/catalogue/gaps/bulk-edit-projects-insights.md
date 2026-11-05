# Gap list: Bulk, Projects, Edit, Insights, Home, Layout

Audit of the original (`feat/rda-catalog-migration`) against our `catalogue` branch, 2026-11-05.

**Path prefixes:** FE = `ai-catalog-frontend:src/`, BE = `ai-catalog-backend:`.

## Three facts that shape the plan
- **No batch entity.** The backend has no `batches` route and no Batch or Album model. Bulk is **client-side orchestration** over the normal product endpoints.
- **The original's "projects" are products.** `ProjectSummary.project_id` is a product id (`lib/api/history.ts:5-22`), and "album" is only wording.
- **Insights is admin-only** (`routes/index.js:50`).

## A. BULK (`/bulk`): missing

### Data and state
Source: FE `features/bulk/bulk-item-status.ts`.
- **Shared setup:** template (recipe, eligible models), category and gender. Setup is ready when all three are set.
- **Item:**
  - identity: `productId` (null until created), name, sku;
  - styling: model, studio background, lifestyle background (+ `includesPose`), notes, pair, footwear, accessoryIds;
  - shot plan: `poseByShotId`, `selectedShotIds`;
  - state: `phase`, error;
  - setup: `lockedShared`, `useCustomSettings` / `customShared`.
- **Phases:**

  | Phase | Label |
  |---|---|
  | editing | "Draft" |
  | generating_initial | "Generating initial" |
  | initial_ready | "Needs approval" |
  | generating_rest | "Generating shots" |
  | completed | "Complete" |
  | failed | "Failed" |

  Phase is re-derived from the server product.
- **Effective settings precedence:** lockedShared, then the item's custom setup, then the batch setup.
- **The board is in memory only** (`bulk-state.tsx:181-189`). Products survive a reload; the board doesn't.

### Lifecycle
Source: FE `features/bulk/bulk-state.tsx`.
- **Limits:** MAX 10 products, 3 concurrent initials, 6 concurrent "rest" shots. These are client-side FIFO semaphores (:40-43, :779-809).
  - Toast: "You can add up to 10 products per batch".
- **Lazy create:** a product is created on the first upload or generate. Each later field edit PATCHes it.
- **Generate initial:**
  - Needs the setup ready, otherwise "Set template, category, and gender first".
  - Snapshots the setup into `lockedShared`.
  - Then: PATCH, then generate initial (backgroundId, `randomizeBackground` if none, initial-shot poseId, model, imageSize, feedback, reference), then poll.
  - Failure toast: "Initial look failed".
- **Other actions:**
  - Regenerate initial (feedback, pose, reference, model).
  - Restore a version.
  - Upload your own initial look.
  - Change the model after an initial exists: confirm, then the product resets to draft.
- **Approve:**
  - Sends `expected_initial_media_id`, `pose_overrides` per shot, `background_overrides` (the lifestyle background for lifestyle shots), an optional `shot_ids` subset, and model/size/feedback/reference.
  - More shots can be dispatched later with per-shot regenerate.
  - Approves already in flight are de-duplicated.
  - Shot failures are combined into one toast, "N shots failed".
- **Polling:** every 2 s (`features/generate/settle-generation.ts`). Aborts if another job took over. Refreshes when the tab becomes visible again.
- **Edits that reset things:**
  - Changing the batch category or gender clears the template and every unlocked row's pool choices.
  - Removing a row aborts its in-flight work.
  - "Clear all" asks for confirmation first.
- **Reopen:** `/bulk?from_product=<id>` seeds one row from an existing product.

### CTA (`deriveCta`, `bulk-item-status.ts:182-266`)
- "Generate initial"
- "Generating…", with "Building the initial look — this can take a minute."
- "Generate all remaining shots" / "Generate remaining shots", with "Regenerate" as the secondary action.
- "Retry initial" / "Retry remaining"
- "Generate selected shot(s) (n)"

Every generate first opens `GenerationModelDialog` (model, size, feedback, reference).

### UI
- **Shared bar:** gender, category, template search, a "Ready to generate" / "Needs setup" chip. It collapses to a top strip when ready.
- **Card:**
  - Header: status chip, remove ×, name input "Product name or SKU".
  - Pickers:
    - model, including "Auto";
    - studio background;
    - lifestyle background (if it includes a pose, the lifestyle shots' poses are dropped);
    - accessories (≤3).
  - Uploads: front, back and detail; pairing (multi, "e.g. inner t-shirt"); footwear; accessory photos.
  - Styling notes, "Included in the prompt for every shot".
  - Initial look tile: pose picker, upload, version strip, compare lightbox.
  - Lock note: "Locked to the setup used when generation started."
  - Pose plan: per-shot pose, checkbox and generate button. Then the gallery.
  - "Use custom settings for this product".

### Our current gaps that block Bulk
- Our UI never sends the `shotIds` subset to approve.
- A second approve returns 409.
- There is no "generate remaining", and no pose or background overrides.
- Statuses don't include failed or partial.

## B. PROJECTS = our Products list
**List:**
- Search "Project name or SKU": server-side, debounced 300 ms.
- Filters: category, gender, status (draft, generating, partial, completed, failed), and created-by (admins).
- "Clear filters".
- 50 per page with infinite scroll.
- Row: thumbnail, category · gender · relative day · N shots, owner (admins), status chip.
- "Open in bulk editor".
- Ours: a client-side filter over the newest 200 only.

**Detail:**
- Polls every 2 s.
- When the initial look exists but isn't approved: lifestyle background picker, per-shot pose plan and selection, "Generate N selected / all remaining shots" through the model dialog.

## C. EDIT (`/edit`): missing
Sources: BE `POST /image-edits`, `controllers/imageEditsController.js`, `services/imageEdits.js:12-24`.
- **Limits:** prompt ≤4000 characters; 1–8 images; model ∈ options; size 1K or 2K.
- **Prompt wrapper, to port verbatim:**
  - "IMAGE EDIT — follow the instruction below exactly and change ONLY what it asks for." then "INSTRUCTION: …".
  - FIDELITY RULES: exact colour/print/texture; no harmonising; everything not mentioned stays identical; nothing added.
  - Then `withOutputSharpness`.
  - Images are called @img1… in upload order.
- **Output:** a plain media object, not linked to any product.
- **UI** (FE `features/edit/edit-workbench.tsx`):
  - "Images (n/8)", drop or pick (png/jpeg/webp).
  - Model radio, default the first; size default 1K.
  - Prompt placeholder: "e.g. change the background to a plain white studio, remove the wrinkles on the sleeve…".
  - Compare slider (Input / Edited), with the choice of which input is "before".
  - Fullscreen compare (Esc closes).
  - Format menu (default png) and download `edited-<id>`.
  - Empty state: "Add at least one image and a prompt, then generate."

## D. INSIGHTS (admin): missing; **no costs, per the user**
- **Period:** Today, 7 days (default), 30 days, This month, Custom (≤366 days, from 2020-01-01). Kept in `?from&to`; days are IST. Compared with the previous period, cut at the same point if the current one is still running.
- **KPI tiles**, each with a delta:
  - active people
  - products completed of started
  - images (with fix notes)
  - kept first time %
  - failure rate
  - time per product (median turnaround · average per image)
  - ~~Est. AI cost~~ (dropped)
- **Chart:** images per day, or per hour (IST) for a single day. By person or by client; stacked top-N.
- **Team table:** Person, Last seen, Products, Completed, Images, Edits, First try, Fix notes, Failures, Per image, ~~Cost~~, Last active. Sortable, default images descending.
- **Clients and templates table:** client = template name before " - ".
- **Unfinished products:** count by status, up to 20 links.
- **Failures:** grouped by cause (Setup / AI provider / System) with code, count, last seen, sample and product links (BE `services/insights.js:15-22, 60-72`).
- **CSVs:** Team and Clients, without cost.
- **Person page:**
  - Products, 20 per cursor page.
  - Per image: shot label, Kept/Not kept, model, fix note, duration, fashion model, and Details (references, pose, background, prompt).
  - Other images (edits). Failures.

## E–G
- **Home:** skip. Our `/catalogue` is the landing page.
- **Coming-soon pages:** skip; they're their credits.
- **Navigation:** original rail is Create, Bulk, Projects, Edit; admins also get Assets, Templates, Insights, Settings. **Ours:** add Bulk, Edit and Insights (admin) to `CatalogueTabs`.

## Mapping the original's projects onto ours
- Original "project" = our **product**.
- Keep the Naar project chips as the album-like grouping.
- Bulk gets a required **Naar project** picker in the shared bar.
- Optionally a `batchId` on products, so a whole batch can be reopened.

## Priorities
- **P0:**
  - approve with shotIds, pose/background overrides and generate-rest; per-request model, size and feedback (M);
  - Bulk workbench (L);
  - Edit (M);
  - tabs (S).
- **P1:**
  - list filters, paging, shot count, "Open in bulk" (M);
  - Insights overview, no cost (L);
  - Insights person page (M);
  - Bulk custom settings and reopen (M);
  - generation dialog (S);
  - failed / partial statuses (S).
- **P2:**
  - upload your own initial look;
  - lifestyle background with "includes pose";
  - garment analysis;
  - batch persistence;
  - stop sending `spendUsd` to non-admins.
