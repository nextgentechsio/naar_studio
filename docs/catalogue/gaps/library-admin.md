# Gap list: Library + Admin

Audit of the original (`feat/rda-catalog-migration`) against our `catalogue` branch, 2026-11-05.

**Path prefixes:**
- FE = `ai-catalog-frontend:src/`
- BE = `ai-catalog-backend:`

Read the original with `git -C ../<repo> show origin/feat/rda-catalog-migration:<path>`.

## Shared rules in the original
- **Asset status** is `active | inactive | archived`, default active (BE `prisma/schema.prisma:10-16`). Ours has no `inactive`.
- **"Delete" in the UI means archive.** Archived items can be restored from the Status filter (FE `features/assets/bulk-selection.tsx`, `asset-list-item-actions.tsx`). Our delete is permanent.
- **List APIs** take `q` (name ILIKE), `status` (admins only), `limit` and `offset` (BE `src/services/assetFilters.js`).

## Entities

### Model
Sources: BE `schema.prisma:171-195`, `src/validators/model.js`, FE `features/assets/model-form/*`.
- **gender:** required, female or male. Ours is nullable.
- **status:** has the 3 values above.
- **Reference images:** **at least 1 required**, several allowed. The first is used for generation.
- **`previewMediaId`:** an optional display thumbnail, separate from the reference images.
- **`wearStyleNotes`:** has a "Generate from photo" button.

### Pose
Sources: BE `schema.prisma:211-240`, `src/validators/pose.js`.
- **Prompt and media:** at least one of the two is required.
- **`wearStyleNotes`:** filled automatically from the image.
- **`style`:** nullable; one of western, active, traditional, sexy, saree.
- **`gender`:** nullable.
- **`shotTypes[]`:** tags; empty means every shot type. There are 13 keys, including `initial_look` (FE `asset-constants/pose-eligibility.ts`).
- **`includesBackground`:** bool.
- **`status`:** the 3 values.

### Background
Sources: BE `schema.prisma:242-279`, `src/validators/background.js`.
- **`backgroundType`:** required, studio or lifestyle.
- **`inputKind`:** `image` (needs media) or `prompt` (needs a prompt).
- **`thumbnailMediaId`:** display-only, for prompt backgrounds.
- **`productCategories[]`:** empty means any.
- **`includesPose`:** lifestyle only.
- **`status`:** the 3 values.

### Accessory
Sources: BE `schema.prisma:496-515`.
- **Prompt and media:** at least one is required.
- **`productCategories[]`:** empty means any.
- **`status`:** the 3 values.

### ProductCategory
Sources: BE `schema.prisma:49-66`; admin page `/admin/settings/product-categories`.
- **Fields:** name, `examples`, `sortOrder` (≥ 0), status, `rdaOutfitType` (top, bottom or coord).
- **Seeded categories** (`db/migrations/006`): **Topwear, Bottomwear, Co-ords, Saree.**
- **Ours:** a hard-coded list of 11 in `shared.ts`. Missing as an entity.

### CatalogTemplate
Sources: BE `schema.prisma:289-325`, `src/validators/catalogTemplate.js`, `src/services/catalogTemplates.js`.
- **status:** draft, active or archived; **default draft**.
- **`productCategories`:** required and non-empty (category ids).
- **`allowedGenders`:** required in the UI.
- **`poseStyle`:** nullable; the template's pose pickers start filtered to it.
- **`allowAutoModelSelection`:** default true.
- **`modelDescriptions`:** JSON of 4 lists: male, female, sunburstMale, sunburstFemale. **One is picked at random per generation.**
- **Export defaults:**
  - `defaultExportWidth`/`Height`;
  - `defaultExportFormat` (jpeg, png or webp; default jpeg);
  - `defaultCropMode` is always null.
- **Other:**
  - `previewMedia[]` (card images);
  - eligible models (`CatalogTemplateModel`, with `isDefault`);
  - eligible accessories.
- **Activation checks** (`catalogTemplates.js:78-117`):
  - at least one active shot;
  - an active Initial Look of type `initial`;
  - every category × gender combination has an Initial Look;
  - at least one eligible model;
  - no inactive eligible assets. The UI offers "Remove inactive items & activate" (FE `version-editor/publish-errors-alert.tsx`).
- **Duplicate** (`POST /:id/duplicate`): makes "Copy of X" as a **draft**, copying the active shots, models, accessories and preview images.
- **Permanent delete:** only after the template is archived.
- **Versions:** no version model any more; it was replaced by draft → Activate.

### ShotDefinition
Sources: BE `schema.prisma:384-432`, `src/validators/shotDefinition.js`.
- **Type and status:**
  - `shotType` is a foreign key to the admin-managed shot types.
  - `isInitialLook` ⇔ `shotType = initial`.
  - `status` has the 3 values.
- **`promptTemplate`:** nullable, with `{{vars}}`.
  - Allowed: garment_image, front_image, back_image, detail_image, model_image, initial_look, pose_image, background, pairing_image, footwear_image, accessories_image (BE `src/constants/promptVariables.js`).
  - Unknown variables or stray braces are rejected.
  - `{{initial_look}}` is not allowed on the initial shot.
  - `{{model_image}}` is allowed only on the initial shot.
  - The editor autocompletes them (FE `prompt-template-field.tsx`).
- **Order:** `downloadSequence` (int) numbers the exported files.
- **Background mode:**
  - `inheritInitialLookBackground` defaults to true.
  - `randomBackgroundFromPool` defaults to false.
  - The two are mutually exclusive.
- **`generationQuality`:** high, medium or low. Initial defaults to high; the others to medium.
- **Audience:** `productCategories` and `genders` are both required and non-empty.
- **Pose eligibility:**
  - `poseShotTypes[]`: link poses by tag;
  - `excludedPoseIds[]`;
  - an eligible pose pool, with a default.
- **Background eligibility:** an eligible background pool, with a default.

### Shot types (ShotTypeConfig)
Sources: BE `schema.prisma:370-382`, seeded in `029_shot_types.sql`.
- **The 13 types:** front, front_full_sleeve, back, side, initial ("Look Shot"), closeup, closeup_front, closeup_back, closeup_dynamic_front, closeup_dynamic_back, lifestyle, dynamic_lifestyle, mood.
- **key:** pattern `^[a-z][a-z0-9_]{1,39}$`; cannot be changed.
- **Restrictions:** `initial` can never be deactivated, and a type in use can't be deleted.

### Generation model settings
- `(engine, model) → poseInput` text or image; default text. Ours always sends text, so this has low priority.

## Admin pages and features: missing or partial
- **Search and filters:**
  - search on every list;
  - status filter (active, inactive, archived, all);
  - gender filter (models, poses);
  - pose filters: style, shot type;
  - background filters: type, category;
  - accessory filter: category.
- **Lists:** paging / load more, multi-select bulk archive (shift-select), and per-item Mark inactive / Archive / Restore.
- **Bulk uploads with review:**
  - poses (`pose-upload-flow.tsx`, `pose-bulk-upload-review-modal.tsx`), with shared defaults for style, gender and shot types;
  - backgrounds (`background-upload-flow.tsx`).
- **AI helpers (vision text model):**
  - **Pose photo → prompt** (POSE/MOOD/CAMERA + WEAR STYLE): BE `src/services/posePromptFromImage.js` and `src/constants/wearStyleVision.js`. Runs automatically on create when the prompt is empty.
  - **Background photo → prompt:** BE `src/services/backgroundPromptFromImage.js` and `src/constants/backgroundVision.js`. Runs automatically for lifestyle backgrounds.
  - **Model photo → wear style:** BE `src/services/wearStyleFromImage.js`.
  - **Thumbnail from prompt** (Nano Banana 2.1, 1K, webp): BE `src/services/backgroundThumbnailFromPrompt.js`.
- **Template editor:**
  - tabs Basics, Recipe (Settings / Shots / Backgrounds / Models / Accessories) and Generations (products made from the template);
  - shot eligibility pickers (`shot-definition-eligibility-pickers.tsx`);
  - backgrounds panel (`catalog-template-backgrounds/*`);
  - model descriptions editor (`version-model-settings.tsx`);
  - preview images;
  - export defaults;
  - upload a new model, background, pose or accessory from inside the template.
- **Settings pages:** product categories, shot types, generation models.
- **Debug generate** (`features/debug/debug-generate-trial.tsx`):
  - a prompt with `@imgN` references, plus reference uploads;
  - size (default 1080*1440) and several models at once;
  - raw JSON in and out.
- **RDA template import:** depends on the Aadai Firebase snapshot. Skip unless we get that data.

## Seed data
- **What the original seeds:** only the 4 categories, the 13 shot types and 1 generation-model setting. It has no hand-written assets or templates.
- **Where its real assets came from:** the RDA importer (40 base templates, 38 shot presets) and `scripts/import-poses-from-folder.js` (`{gender}/{category}/{shot type}/*.jpg`).
- **Ours:** the presets are text only (6 personas, 10 poses, 6 backgrounds, 3 accessories, 3 templates). The original requires an image on every Model.

## Priorities
- **P0:**
  - product categories as an entity (M);
  - `inactive` status, delete = archive, restore (S);
  - search and filters (M);
  - pose, background and accessory fields (S);
  - template audience fields, and per-shot genders, categories, quality and status (M);
  - draft → Activate with the checks; duplicate as draft; permanent delete only after archive (M).
- **P1:**
  - AI photo-to-prompt helpers (M);
  - per-shot eligibility pools (L);
  - template eligible models and accessories (M);
  - managed shot types (M);
  - image-role prompt variables (M);
  - several model images plus a preview (M);
  - bulk upload with review (M);
  - bulk select and paging (S).
- **P2:**
  - model descriptions (S);
  - prompt-background thumbnails (S);
  - preview images (S);
  - export defaults and `downloadSequence` (S);
  - Generations tab (S);
  - debug generate (M);
  - pose input setting (S);
  - upload-from-template (S);
  - RDA import (L).
