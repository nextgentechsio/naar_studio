# Catalogue: handoff for the next session

**Status (2026-11-05):** phase 1 is built and verified, not committed. Branch: `catalogue` (based on `af3ab4e`).

## 0. What's built (phase 1)

- **Server:** `lib/catalogue/`
  - `shared.ts`: types and limits.
  - `db.ts`: collections `catalogueAssets`, `catalogueTemplates`, `catalogueProducts`, `catalogueRuns`, and the Blob folders `catalogue/library/` and `catalogue/<owner>/products/<id>/`.
  - `library.ts`: assets and templates CRUD (admins edit). Presets are seeded insert-only; a deleted built-in is kept as a `deleted` marker so it isn't seeded again.
  - `presets.ts`: 6 personas, 10 poses, 6 backgrounds, 3 accessories, 3 templates.
  - `prompt.ts`: `buildShotRequest`, ported from ai-catalog `buildPrompt`, with reference ranking and capping.
  - `run.ts`: `startImageRun`, the same steps as `/api/generate`, which is left untouched. Records the generation, so it is priced and expensed. Caches the model schema.
  - `products.ts`: the flow.
    - Create (needs an active project), then upload inputs (each must be in the product's folder), then choose a template (its shots are copied into `plan`).
    - `generate` the initial look (feedback attaches the previous attempt), `select` a version, `approve` (starts the rest of the shots, 4 at a time, with the initial look as a reference), `regenerate`.
    - GET syncs pending runs (`fetchGenerationStatus` → `applyPrediction`) and copies each finished image to `catalogue/…/shots/`.
    - Delete removes the product's files; its generations and expenses stay.
  - `http.ts`: the route wrapper.
- **API:** `app/api/catalogue/`
  - `library` (GET, POST asset)
  - `assets/[id]`, `templates`, `templates/[id]`
  - `products`, `products/[id]`, `products/[id]/[action]` (`generate`, `approve`, `regenerate`, `select`)
  - `upload` (Blob token, path-checked)
- **UI:** `app/(studio)/catalogue/`
  - Products list, plus a 5-step workspace under `[id]/`.
  - `library/`: browse for everyone, edit for admins (template editor included).
  - Client helpers: `lib/client/catalogue.ts`.
  - Outside edits: one nav item in StudioShell, and the `shirt` icon in Icon.tsx.
- **Tests:**
  - `tests/integration/catalogue.test.ts` (16) `tests/unit/catalogue-prompt.test.ts` (18), and `tests/unit/catalogue-direct.test.ts` (4). The full suite passes (314 tests).
  - `blob-uploads.test.ts` now only checks its own Blob listings, because the fake's request log is shared across test files.
- **Browser check:** create, upload, template, initial look, approve, 6/6 shots, spend $0.606; dark, light and phone views all render.

**Projects and cost tracking** (added after phase 1):
- **By project:** Catalogue is organised by project, with a project bar on `/catalogue` (`?project=<id>`).
- **Spend shown:** the bar shows the project's catalogue spend, product count and image count, and links to `/expenses?project=<id>`.
- **Data source:** spend comes from `expenses` joined to `catalogueRuns`, so it matches Expenses exactly. Each card shows its product's spend.
- **New products** default to the project being viewed.
- **Project lock:** a product's project locks once anything has run (409 + `projectLocked`), so its costs never split across projects.

**Direct Google / OpenAI** (the original catalogue's keys, `NANO_BANANA_API_KEY` and `OPENAI_API_KEY` in `.env.local`):
- **Where:** `lib/catalogue/direct.ts`.
- **Image models:** `google:gemini-nano-banana-2.1` (generateContent, 3:4, 1K/2K) and `openai:gpt-image-2.5-sunburst` (images/edits with the reference photos; 1104x1472 or 1536x2048, medium quality).
- **How each run works:**
  - It is a `generations` record with provider `google` or `openai`, model `google-api/…` or `openai-api/…`.
  - It runs on our server inside `after()`, like ElevenLabs.
  - It finishes through `finishLocalRun`, which saves the image and records the expense.
- **Pricing:** from the tokens each provider reports, using the list prices in `DIRECT_PRICES` (the original's `insightsCost.js`, 23 Oct 2026). If usage is missing, it falls back to an estimate.
- **Shared code changes** (Google and OpenAI added as platforms):
  - `lib/db/mongodb.ts`: `Provider`, `providerName`, `isLocalProvider`.
  - `generations.ts` and `generation-cancel.ts`: these runs count as local.
  - `cost-analytics.ts`, `lib/client/data.ts` (PLATFORMS) and Dashboard: series, plus `--viz-4` / `--viz-5` in `globals.css`.
  - History drawer: no "Run again" for these runs.
- **Tests:**
  - Fakes at `/google` and `/openai` in `fake-replicate.ts`.
  - `global-setup.ts` overrides the keys and base URLs (`GOOGLE_AI_BASE_URL`, `OPENAI_BASE_URL`), so tests never reach the real APIs even though `.env.local` holds real keys.
- **Real check (2026-11-05):**
  - OpenAI made a correct 1104x1472 image for $0.012.
  - Google failed: the key's project is on the **free tier**, which allows 0 Nano Banana calls. Billing must be enabled on that Google project.
  - Until then, the default model is Replicate `google/nano-banana-2`. Switch `DEFAULT_IMAGE_MODEL` in `shared.ts` to `google:gemini-nano-banana-2.1` once Google works.

**Next phases (not started):** Bulk (many products, shared settings), image Edit, Insights (catalogue spend from `expenses` joined to `catalogueRuns`), upload-your-own initial look, crop/export sizes, optional garment analysis (a text model; decide how to bill it), and the brand profile from the prototype.


## 1. What the user asked for

> "In my workspace I have a repo, naar-ai-catalogue. Read the code; it's a new platform, like a catalogue. I need the same replicated here on our platform, and as usual the cost management is ours. Use multiple agents."

The user later confirmed: "yes correct go ahead".

What that means:

- **The feature:** rebuild the AI catalogue product (catalogue imagery for fashion brands) as a new **Catalogue** section inside Naar Studio.
- **Generation:** every image or video goes through Naar Studio's existing generation pipeline.
- **Costs:** every run appears in our existing cost tracking (Dashboard / Expenses / History). Do not copy the catalogue's own credits or "tokens", which are a hard-coded mock anyway.

**Standing rule** (from the user, in memory): new features stay isolated. Use their own folders and their own MongoDB collections. Reuse existing code by importing it, and keep edits outside the new folders to a minimum ("maintain all separate, should not disturb anything").

## 2. Source repos (all in `/Users/naarlaptop/Documents/Workspace/`)

| Repo | What it is |
|---|---|
| `naar-ai-catalogue` | Next 14 + Firebase front end, ~1,950 lines. **This is the UI to replicate.** Mostly mock data, with no AI. |
| `ai-catalog-backend` | Express + Prisma (Postgres) + S3. **Holds the real engine and all prompt engineering.** |
| `ai-catalog-ai-service` | FastAPI. Only executes provider calls (Gemini Nano Banana, OpenAI Sunburst, Qwen/Wan, Seedream) and returns base64. |
| `ai-catalog-frontend` | Next front end for the real product (5-step Create flow, Bulk, Projects, Edit, Admin). |

**Important:** `main` is an old stub in all three `ai-catalog-*` repos. The working code is on the remote branch **`origin/feat/rda-catalog-migration`**, updated 2026-11-05.
- **How to read it:** `git -C ../ai-catalog-backend show origin/feat/rda-catalog-migration:<path>`. Don't check the branch out or modify those repos.
- **Secrets:** never print values from `.env` files.
- **Relationship to `naar-ai-catalogue`:** it is an earlier design prototype (May 2026) of the same brand and idea. `ai-catalog-frontend` deliberately dropped its Brand DNA, Generate Video, Ghost Mannequin and trained-model (LoRA) pages as out of scope. None of those exist in the real engine.

## 2b. The real engine (`feat/rda-catalog-migration`)

### Data (Prisma; to be re-done as Mongo collections here)
- **Product** = one project. Fields:
  - basics: `name`, `sku`, `category`, `gender`, `notes`, `templateId`, `modelId`, `accessoryIds[]`
  - `status`: draft, generating, completed, failed, pending_review or partial
  - `inputImages`: a map from slot to media
  - `outputImages`: `initial`, `approved`, `pose_id`, `background_id`, `shots{shotId→media}`, `traces{prompt,references,model}`, `generation_history`, and pose/background overrides
- **Input slots:**
  - garment views: `front`, `back`, `detail`, plus `*_extra[_2]`
  - print crops: `pattern_{front,back,detail}`
  - styling: `pairing…pairing_5`, `footwear`, `accessories…_5`
- **Asset library** (each item is active, inactive or archived; admins have full CRUD, creators pick):
  - **Model** (a human persona): name, gender, `wearStyleNotes`, face photos.
  - **Pose**: name, `prompt` (a POSE / MOOD / CAMERA text brief), style (western, active, traditional, sexy or saree), gender, `shotTypes[]`.
  - **Background**: studio or lifestyle, `prompt`, image, `productCategories[]`.
  - **Accessory**: name, prompt, image.
  - **ProductCategory**: name, outfit type (top, bottom or coord).
- **CatalogTemplate** (the "recipe"):
  - Fields: name, categories, allowed genders, poseStyle, `modelDescriptions` (styling), default export w/h/format/crop, default models and accessories.
  - Shots: **ShotDefinition[]**. Each has a `shotType` (initial, front, back, side, lifestyle, closeup*, dynamic*, mood…), `isInitialLook`, `promptTemplate` with `{{vars}}`, export size/format/crop, `downloadSequence`, eligible pose and background pools, `generationQuality`, and `inheritInitialLookBackground`.
- **ProductGeneration**: version history per shot (current or superseded), with feedback and the model used.

### Flow (the product to rebuild)
1. **Details:** name, SKU, category and gender; upload garment photos into slots. Optional **analyze-garment** (a Gemini text model returns a description and suggests a pairing and footwear).
2. **Template:** pick a catalog template.
3. **Model:** pick a model persona, or "auto". Add up to 3 accessories. Optional pairing, footwear, mood, age and scene preset.
4. **Initial Look:**
   - Generate one image from the garment, model-face, background, styling and accessory references, plus a long block prompt.
   - Choose the generation model (Nano Banana 2.1 or Sunburst) and the size (1K or 2K).
   - Give feedback and regenerate (a Gemini text call rewrites the prompt), choose a candidate, or upload your own initial look.
5. **Approve:** lock the Initial Look, then generate **every other shot** in the template, using the Initial Look as the continuity reference ("SESSION CONTINUITY…"). Poses and backgrounds can be overridden per shot.
6. **Result:** a gallery where each shot can be regenerated with feedback, restored to an older version, cropped, or downloaded (each shot or all; format and size from the template).
- **Also:** **Bulk** (many products with shared settings, each reviewed and approved), **Projects** (albums), **Edit** (free-form image edit: "IMAGE EDIT — change ONLY what it asks…"), and **Admin** (asset and template CRUD, AI helpers that turn a pose or background photo into a prompt, and Insights).

### Prompting (port this; it's the valuable part)
- **Source:** `ai-catalog-backend/src/services/productGeneration.js`, mainly `buildPrompt`, `collectReferences`, `rankReferences` / `packReferencesToCap`, `generateInitialLook`, and the approve and regenerate functions.
- **Prompt blocks:** SKIN DEPTH LOCK, CANONICAL LOOK, a reference role map ("each reference image has exactly one job"), FACE/SKIN/MAKEUP/HAIR LOCK, BODY PROPORTION LOCK, the POSE STANCE/MOOD/FRAME brief, SHOT: <template>, ACCESSORIES, PAIRING LAYERING, STYLING, wear-style notes, a lighting block, garment fit, Finish, and **GARMENT COLOR — DO NOT CHANGE**.
- **Always appended:** `OUTPUT_SHARPNESS`.
- **The pose is passed as text, not as an image.**
- **Constants:** `src/constants/` (shotPromptTemplates, outputSharpness, garmentColorLock, catalogReferenceQuality, wearStyleVision, backgroundVision).
- **Text prompts:** `src/services/rda/textSteps.js` (describeOutfit / refinePrompt).
- **Vision helper prompt:** the AI service's `POSE_TO_PROMPT_INSTRUCTION`.
- **Post-processing (sharp):**
  - outputs are re-encoded as JPEG q95 at 1080x1440 (3:4) or the template's export size;
  - 480 px thumbnails;
  - a face crop and a skin-depth (Fitzpatrick) estimate from the model photo;
  - pairing, footwear and accessories are combined into one styling reference image.
- **Not used:** background removal, upscaling and try-on models. Everything is done by prompting a reference-image model.
- **Image models used live:**
  - `gemini-nano-banana-2.1` (default, 3:4, 1K or 2K, up to 8 references). **Ours:** `google/nano-banana-2` on Replicate, priced.
  - `gpt-image-2.5-sunburst` (up to 16 references). **Ours:** `openai/gpt-image-2.5-sunburst` on Replicate, priced.
  - Text and vision: `gemini-flash-latest`. We have no Gemini text model priced. Use the existing **Anthropic** integration (`ANTHROPIC_API_KEY` in `.env.local`; the Assistant lives on branch `chat`) or skip it. Text-call cost would need its own expense handling.

### Their costs (we replace these with ours)
They have no credits or billing. `src/services/insightsCost.js` only estimates cost for admin Insights, using hard-coded token prices. We use our own `expenses` instead, and every image call goes through our generation pipeline.

## 3. What naar-ai-catalogue contains

### Routes
- **`/login`** has two columns: a forest-coloured panel with the fashion images, and a light form card. It uses Firebase email, Google and Apple login. **Skip it here:** Naar Studio already has auth.
- **`/onboarding`** is a scripted "chat" (left) plus a decorative live "builder preview" (right). It has 6 steps, and each answer is saved straight away, so the flow can be resumed:

  | # | Key | Question | Type | Options | Field |
  |---|---|---|---|---|---|
  | 1 | brand | "What's the name of your brand?" | text | | `brandName` |
  | 2 | industry | | select | Fashion, Luxury, Streetwear, Sportswear, Accessories, Beauty, Lifestyle | `industry` |
  | 3 | style | | select | Minimal, Editorial, Luxury, Lifestyle, Street, Commercial | `visualStyle` |
  | 4 | models (age ranges) | | multi | 18-25, 25-35, 35-45, 45-55, 55+ | `modelPreferences.ageRanges` |
  | 5 | channels | | multi | Shopify, Instagram, TikTok, Website, Amazon, Print, Pinterest | `publishingChannels` |
  | 6 | review | | "Enter Dashboard" button | | `onboardingComplete: true` |

  Also in the schema but never asked: `category`, `modelPreferences.bodyTypes`, `modelPreferences.ethnicities`.
- **`/` Home:**
  - Hero: "Your AI catalog studio".
  - Four quick actions: **Generate Image**, **Generate Video**, **Ghost Mannequin** ("Remove mannequins and create invisible model shots"), and **Change Model** ("Swap AI models on existing product shots"). All four only show a "Coming soon" alert.
  - A "Recent projects" strip of cards (title, SKU, status `approved | review`). The data is mock.
- **`/models`, "AI Models":**
  - Active-model hero: name, Brand Accuracy %, Training Frames, and a "Generate with this Model" button.
  - "Your Trained Models" roster: one card is **active**, the others are **ready** or **training** (with a progress bar). It also has a dashed "Train New Model" card.
  - "Model Marketplace" with filter tabs (All, Fashion, Luxury, Diverse, Seasonal) and cards showing name, agency, rating and price. All of this is mock data in `src/components/models/models-data.ts`.
- **Placeholders ("Coming soon"):** `/brand-dna`, `/productions`, `/batch`, `/dashboard` ("Insights") and `/settings`.

### Data
Firestore holds a single document type, `users/{uid}`: profile, onboarding fields and `onboardingStep`. There are no models, projects or credits collections. The top bar's "2,400 tokens | Pro" is hard-coded.

### Look
Use our existing glass tokens, but this is the catalogue's own palette, if we want to echo it:

- **Palette:** dark background `#06080b`, forest `#021111`, mist `#eaebed`.
- **Accents:** cyan `#00ccdd` (primary), magenta `#9f5cff`, gold `#ff8931`, green `#42e6a4`, danger `#ff5277`.
- **Font and radii:** Lufga font; radii are button 14, card 18, panel 22, hero 24.
- **Cards:** portrait 3:4 image cards with a bottom gradient and a glass meta panel.
- **Status colours:** cyan = active, gold = training/review, green = approved/free.
- **Sidebar order:** Home, Models, Brand DNA | Productions, Batch, Insights | Settings.

## 4. How it plugs into Naar Studio (verified)

### Starting runs
Reuse the existing routes and helpers. **Do not write a new provider client.**

- **Replicate:** `POST /api/generate` (`app/api/generate/route.ts`), body `{ project, model, inputs }`.
  - Checks, in order: `requireUser`, then `isValidModelId`, then `findActiveProjectByName` (the project must be active).
  - Then it fetches the model's schema and runs `shapeInputs` / `missingRequired` (`lib/replicate/inputs.ts`).
  - Then it creates the prediction and calls `recordGeneration`.
  - It returns `{ tracking: { predictionId, ... }, costUsd }`.
- **Higgsfield:** `POST /api/higgsfield/generate`, same contract.
- There is **no exported `startGeneration` in `lib/`**. Either call these routes from the client, or pull their bodies into a shared helper. That second option is a small refactor of existing files, so keep it minimal, or have the Catalogue server call the same lib functions in the same order.

### Finishing runs and costs
- **Polling:** `GET /api/predictions/[id]` calls `fetchGenerationStatus`, then `applyPrediction` (`lib/generations.ts`).
- **What `applyPrediction` does:** computes the cost (`calculateReplicateCost`, or the Higgsfield cost), saves the output to Blob `outputs/`, and calls **`recordExpense`** (`lib/spend/expenses.ts`).
- **No double charging:** expenses are insert-only, keyed by the generation id.
- **Visible everywhere:** the run then shows up in History, Dashboard and Expenses automatically.
- **The browser poller** lives in `app/(studio)/_generate/GenerateProvider.tsx` (every 2 s, 15-minute timeout). As a safety net, `reconcilePending` runs from `GET /api/generations`.
- **Use priced models.** A model must be in `MODEL_IDS` in `lib/replicate/cost.ts` to get a price; otherwise its expense is recorded with `amountUsd: null`.

### Cost features we don't have
- There are **no per-user or per-project spend limits** anywhere.
- Expense filters cover project, user, model, provider and date only. They **can't show "Catalogue" spend on its own**. If the user wants that, keep a `catalogueShots` collection mapping generation ids to batches and products, rather than adding fields to `generations` / `expenses`.

### Models available now
- **Image editing with reference images:**
  - `google/nano-banana` ($0.039, `image_input[]`)
  - `google/nano-banana-2` (priced per tier, up to 4K)
  - `google/nano-banana-pro`
  - `openai/gpt-image-2.5-sunburst`
  - `bytedance/seedream-5-pro` ($0.09 per image; priced but not in `MODEL_CATALOG`)
- **Upscaling:** `philz1337x/crystal-upscaler`, `topazlabs/image-upscale`.
- **Video:** Kling v3 omni and Seedance 2.0 / 2.5 (Replicate), plus Higgsfield models, which come live from its API.
- **Not available:** any try-on model, background removal, or Flux Kontext. Each would need a `MODEL_IDS` entry plus a price branch in `cost.ts`. Prefer **nano-banana with garment + model reference images** for "Change Model" and "Ghost Mannequin".

### How an isolated feature is built
Follow the **Messenger / Notifications** pattern:
- **Collections:** get them from `getDb()`, with indexes created once through a promise on `globalThis` (see `collections()` in `lib/notifications.ts` and `lib/messenger/server.ts`). **Do not edit `lib/db/mongodb.ts`.**
- **Pages:** `app/(studio)/<feature>/page.tsx` (server, `metadata`) plus `<Feature>View.tsx` (client), modelled on `app/(studio)/elements`.
- **API routes:** under `app/api/<feature>/...`, each starting with `const auth = await requireUser(); if (auth.response) return auth.response;`. This is Next 16, so `params` is a Promise. For new routes, type it as `{ params: Promise<{ id: string }> }`.
- **Client helpers:** `fetchJson` and `errorMessage` from `lib/client/http.ts`; uploads with `uploadInputFile` from `lib/client/upload.ts`.
- **Uploads are temporary:** files in `inputs/` are deleted after the retention period. Product photos that must last belong in a Blob folder of their own, such as `catalogue/<userId>/…`. Retention cleanup only prunes `outputs/` and `inputs/`.
- **Navigation:** add one item to `navGroups` in `app/(studio)/_components/StudioShell.tsx`, and new icons, if needed, in `app/components/ui/Icon.tsx`. Both changes are additive.
- **Roles:** `requireUser(roles?)`, plus the helpers in `lib/auth/roles.ts`. Every billed run needs an active **project**: catalogue runs must pick one, using `listProjects` / `findActiveProjectByName`.

### Tests
- **Setup:** integration tests use `tests/integration/helpers.ts` (`api`, `loginRoot`, `createUser`, `createProject`, `startGeneration`, `pollPrediction`, `setPrediction`, `fakeOutputUrl`, `db`) with the fake server in `fake-replicate.ts`. In the fake, any `owner/name` model has a generic schema with `prompt`, `image` and `image_input[]`.
- **Pattern** (see `generation-flow.test.ts`):
  1. Start a catalogue shot.
  2. Call `setPrediction(id, {status:"succeeded", output:[fakeOutputUrl()]})`.
  3. Call `pollPrediction`.
  4. Assert one expense with the table price.
  5. Assert the catalogue collection links to the run.
- **Commands:** `npx vitest run` (full suite: 276 passing on the `transformation` work), `npx tsc --noEmit`, `npm run lint`. For browser checks, use the hold-test pattern (a temporary `tests/integration/zz-manual-hold.test.ts` with Playwright in the scratchpad), and delete the hold test afterwards.

## 5. Plan (revised after reading the real engine)

Everything lives under `app/(studio)/catalogue/`, `app/api/catalogue/` and `lib/catalogue/`. Collections are prefixed `catalogue*`; Blob files go under `catalogue/`. The rebuild follows **ai-catalog-frontend/backend** (the working product). The naar-ai-catalogue prototype only supplies the onboarding/brand questions and some look-and-feel.

1. **Foundation**
   - Collections: `catalogueAssets` (models, poses, backgrounds, accessories; one collection with a `kind` field), `catalogueTemplates` (with embedded shot definitions), `catalogueProducts` and `catalogueShots` (generation id → product, shot, version).
   - Admin CRUD for assets and templates. Admin = `canManageProjects` (admin and super admin); users pick from active items.
   - Seed a starter set: a default template with Initial, Front, Back, Side, Closeup and Lifestyle shots, plus a few poses and backgrounds. Prompts come from `src/constants/shotPromptTemplates` and the pose prompts.
2. **Create flow** (Details → Template → Model → Initial Look → Result)
   - Garment uploads go to Blob `catalogue/<userId>/products/<id>/<slot>`.
   - **Prompt builder:** `lib/catalogue/prompt.ts`, a port of `buildPrompt` and the reference packing.
   - **Every image call** goes through the existing Replicate start logic (same as `/api/generate`): `google/nano-banana-2` by default, `openai/gpt-image-2.5-sunburst` as the alternative, with `image_input` references, a Naar **project** (required for billing) and `recordGeneration`. Cost and History then come for free.
   - Polling uses `/api/predictions/[id]`. A Catalogue route then links the finished output to the product shot.
   - Approve fans out the rest of the shots, with the Initial Look as a reference.
   - Each shot can be regenerated with feedback, restored to an earlier version, and downloaded. Do crop/resize export client-side (canvas) to avoid adding sharp.
3. **Bulk:** many products with shared template, model and project; initial looks queued with limited concurrency; review and approve each.
4. **Edit:** free-form image edit through nano-banana-2 ("IMAGE EDIT — change ONLY…").
5. **Insights:** catalogue run counts and spend, from `expenses` joined to `catalogueShots`.
6. **Brand profile (optional, from the prototype):** brand name, industry, style, ages and channels, added to prompts as styling.
7. **Navigation:** one "Catalogue" item in the Create group; tabs inside it (Create, Bulk, Projects, Edit, Library/Admin, Insights).

Text and vision helpers (analyze-garment, refine with feedback, pose photo → prompt) are optional in phase 1. If added, use the existing Anthropic setup and decide how to count their cost, since our expenses only cover generations today.

Each step: integration tests (fake Replicate), then the full suite, typecheck, lint, a browser check, and a report to the user.

## 6. Open questions (defaults in brackets)

- Default image model: [`google/nano-banana-2` at 2K, 3:4; Sunburst as the option].
- Who manages templates and assets: [admins + super admin; users only create products].
- Whether text-helper (Claude) costs should appear in Expenses: [phase 1 has no text helpers].
