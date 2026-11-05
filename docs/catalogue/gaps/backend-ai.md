# Gap list: Backend API + AI service

Audit of the original (`feat/rda-catalog-migration`) against our `catalogue` branch, 2026-11-05.

**Path prefixes:** BE = `ai-catalog-backend:src/`, AI = `ai-catalog-ai-service:app/`.

## Two engines, two Google wire formats
- **Legacy engine** (`productGeneration.js` `buildPrompt`, which our `prompt.ts` ports): `providerForModel("gemini-nano-banana-2.1")` returns `nano_banana`, which uses the **`/v1beta/interactions`** endpoint (`aiService.js:119-130`).
- **RDA engine:** `callRdaImage` forces `provider:'gemini_image'` (`rda/imageCall.js:114`), which uses **`generateContent`** with the same model id.
- **Ours:** `generateContent`, i.e. the RDA wire format with the legacy prompts.

## Endpoints we lack or only partly have
- **`GET /products`:** paging plus filters `catalog_template_id, status, category_id, gender, q, created_by`.
- **`GET /products/:id`:** also returns `export_config` and `generating_shot_ids`.
- **`PATCH /products/:id`:** a template or model change **wipes the outputs** and resets to draft (`outputsInvalidatedBy`). Returns 409 `PRODUCT_BUSY` while generating.
- **`POST analyze-garment`:** `describeOutfit` → description, `aipair`, `aifootwear`.
- **`POST generate-initial`:**
  - Body: feedback, background_id, pose_id, model, image_size, reference_media_id, reference_type (freeform/bg/pose/bgPose), randomize_background.
  - Header: `Idempotency-Key`.
  - An explicit image_size is saved as the product's preference.
- **`select-initial`; `set-initial-upload`** (upload your own initial look).
- **`approve-initial`:**
  - Body: shot_ids, pose_overrides, background_overrides, plus model/size/feedback/reference.
  - Validation: no pose override on dynamic shots, and no background override on shots that inherit the initial look's background.
- **`regenerate-shot`:** shot_id, feedback, model, pose_id, background_id, reference_media_id, image_size, reference_type.
- **`restore-shot`; `crop-shot`** (image_base64 → `shot_crops`).
- **`POST /image-edits`:** prompt ≤4000, 1–8 media, model, size (`services/imageEdits.js`).
- **Admin vision helpers:**
  - `poses/generate-prompt`;
  - `backgrounds/generate-prompt`;
  - `models/generate-wear-style`;
  - `backgrounds/generate-thumbnail` (thumbnail pool of 2, 640 px webp).
- **Templates:** `/picker`, `/duplicate`, `/activate`, `/permanent`, `*-from-upload`, per-shot pose and background pools, models, accessories, preview media.
- **Admin `/debug/generate`.**

## Provider calls

### A. Google `interactions` (`AI providers/nano_banana.py`)
- **Request:** `POST https://generativelanguage.googleapis.com/v1beta/interactions`, header `x-goog-api-key`.
  ```
  {model,
   input:[{type:"image",mime_type,data:b64}…,{type:"text",text:prompt}],
   response_format:{type:"image",mime_type:"image/jpeg",aspect_ratio,image_size},
   seed?}
  ```
- **No `safetySettings`.**
- **`_parse_size`:**
  - "1K"/"2K"/"4K"/"512" → 3:4 at that size;
  - "W*H" → the nearest of 15 ratios, at 2K;
  - empty → 3:4 at 2K.
- **Response:** the first `steps[].content[]` item with `type=="image"` and `data`; content type jpeg.

### B. Google `generateContent` (`AI providers/gemini_image.py`)
- **Request body:**
  - `generationConfig:{imageConfig:{aspectRatio:"3:4",imageSize}}` (**no responseModalities**);
  - `safetySettings`: DANGEROUS, HARASSMENT, HATE, SEXUAL, each BLOCK_ONLY_HIGH;
  - `contents:[{role:"user",parts:[inlineData…,text]}]`.
- **Response handling:**
  - Malformed JSON → 502, not retryable.
  - `blockReason`, or `finishReason` ∈ {SAFETY, RECITATION, LANGUAGE, BLOCKLIST, PROHIBITED_CONTENT, SPII} → 422, not retryable. This check runs **before** looking for an image.
  - No candidates → 502, retryable.
  - Image = the first part with **`!thought`** and `inlineData.data` + `mimeType`.
- **Our bugs and diffs** (`direct.ts`):
  - We don't skip `thought` parts, so we can save a draft image.
  - We send `responseModalities`.
  - Our safety-category order differs.
  - We don't separate blocked / no-candidates / retryable, and we don't keep `modelVersion`.

### C. OpenAI (`AI providers/openai_images.py`)
- **Request:** timeout 300 s.
  - **With references:** multipart `/images/edits`. Field `image[]` for more than one reference, else `image`; filenames `ref-{i}.jpg|png|webp`.
    - Form: model, prompt, size, quality, output_format, n:"1".
    - `input_fidelity`: only for gpt-image-1/1.5/chatgpt-image, never Sunburst.
    - `moderation`.
  - **Without references:** JSON `/images/generations`.
  - **Size normalisation:** sides floored to multiples of 16, aspect between 1/3 and 3.
- **Callers:**
  - **Legacy:** quality high for the initial look, otherwise the shot's `generationQuality` (default medium); **png**; no moderation; size 1104*1472 / 1536*2048.
  - **RDA:** jpeg, `moderation:'low'`. The prompt goes through `withSunburstMediumContrast`, which strips contrast words and appends " Medium contrast." (`rda/sunburstFlow.js:73-84`).
- **Ours:** quality always medium, timeout 240 s.

### D. Shared rules
- **References:** jpeg/png/webp only (else 400), ≤50 MB each.
- **Prompt:** ≤32000 characters.
- **Reference caps:** Google 8, OpenAI 16.
- **Timeouts:** Google 180 s, OpenAI 300 s, whole request 360 s.
- **Error envelope:** `{code, message, details{retryable, provider_status, provider_body}}`. Retryable when the provider status is in {408, 429, 500, 502, 503, 504}.

### E. Text and vision (`AI providers/gemini_text.py`)
- **`/v1/text`:** `generateContent` on `gemini-flash-latest`.
  - `responseMimeType` / `responseSchema` only when there is a schema.
  - Safety per call: BLOCK_ONLY_HIGH or BLOCK_NONE.
  - Parts are text or image_url (fetched → inlineData), at most 16.
  - Result = the non-thought text parts joined.
- **`/v1/describe`:** `[image, instruction]`, BLOCK_ONLY_HIGH.

## Orchestration
- **Product statuses:** draft, generating, completed, failed, pending_review, partial. `completed` when every non-initial shot has output, else `partial`. Any failure sets `failed` and logs a ProductGenerationFailure row.
- **Busy rule:** `generating` blocks select, upload, restore, crop and PATCH (409 `PRODUCT_BUSY`).
- **Per run:**
  - versions go current → superseded;
  - `traces{prompt, references, model, durationMs, feedback, provider, model_version}`.
- **Retries:**
  - **Legacy:** `AI_SERVICE_GENERATE_RETRY_COUNT=1`, backoff 1500 ms × attempt.
  - **RDA Gemini** (`withRetry`, `imageCall.js:22-52`): up to 5 attempts.
    - Rate errors (`429|RESOURCE_EXHAUSTED`): wait `5000×n + rand(1000)` ms.
    - Transient errors (5xx, network, "No valid candidates"): wait `1200×n + rand` ms.
    - Plus an outer loop on 503: 3 attempts, `2000×n` ms.
  - **Sunburst: never retried** (the outcome of a paid call is unknown).
- **Partial failure** (RDA approve): each shot fails on its own and its siblings continue.
  - Fatal errors: `429|quota|blocked`, `REFERENCE_REFINE_FAILED`, VALIDATION, …
- **Concurrency:**
  - AI-service pools: `AI_SERVICE_MAX_CONCURRENT=4`, thumbnails 2.
  - RDA shots: `RDA_SHOT_CONCURRENCY=3`; legacy `GENERATION_CONCURRENCY=10`, capped by the pool.
- **Ours:** zero retries. Every shot's direct call runs **at the same time** in one `after()` (risking 429s and the 300 s `maxDuration`). No busy guard on generate-initial (double clicks mean double paid runs). No failed/partial status, no trace, and no final prompt stored.

## Text steps (`BE services/rda/textSteps.js`)
- **Model:** `rdaTextModel()` = `RDA_TEXT_MODEL`, default `gemini-flash-latest`.
- **`describeOutfit`** (:165-199):
  - Prompt: `DESCRIBE_OUTFIT_SOURCE` (:103-157), with front and back media, outfitType, gender and the notes, plus fixed pairing and footwear lists.
  - Schema: `DESCRIBE_OUTFIT_SCHEMA` (:70-79) → outfitDescription, outfitBackDescription, aipair, aifootwear.
  - 3 attempts with `2000×n` sleep; a quota error fails immediately; trailing periods are trimmed.
  - **`RDA_GARMENT_DETAILS`** (`garmentDetails.js`): adds `constructionDetails` and "Preserve these garment details exactly as photographed: …".
- **`refinePrompt`** (:201-367):
  - When (legacy): only when feedback or a reference image is given (`resolveRefinedPrompt`, PG:1100-1115).
  - Reference types: bg/pose/bgPose use `referenceInstructions[type]`.
  - Prompt: `REFINE_PROMPT`. Keeps `@imgN` tokens, edits the target text in place, supports shot targeting, has reference-image rules and an optional camera-framing block.
  - No schema; BLOCK_NONE.
  - Failure handling:
    - Without a reference image: 1 attempt, falling back to the original prompt.
    - With a reference image: 3 attempts, and the result must differ from the input, else `REFERENCE_REFINE_FAILED`.
  - Then `withOutputSharpness`.

## Post-processing (`BE utils/imageProcessing.js`)
- **Legacy:** cover-resize to the export size, otherwise native size; JPEG q95 mozjpeg; 480 px thumbnail at q78.
- **Helpers:** face crop (1024², `attention`), skin depth (96²), styling composite, pattern swatches.

## Priorities
- **P0:**
  1. Skip thought parts; fail on blocks (S).
  2. Pick the Google wire format: **interactions** for the legacy prompts, with generateContent as a fallback (M).
  3. Retries as above, with OpenAI never retried (M).
  4. A concurrency queue for direct runs (4 at once, 3 per product) with timeouts of Google 180 s and OpenAI 300 s (M).
  5. OpenAI quality high for the initial look, the per-shot override, and 300 s (S).
  6. A busy guard on generate-initial, plus an idempotency key (S).
  7. Reference validation: jpeg/png/webp only, 50 MB, prompt ≤32000 (S).
- **P1:**
  - text client;
  - refinePrompt;
  - analyze-garment + describeOutfit;
  - approve options;
  - failed / partial statuses, failure log and traces;
  - reset outputs when the model or template changes;
  - set-initial-upload;
  - crop-shot;
  - image-edits.
- **P2:**
  - vision helpers and thumbnails;
  - server-side post-processing;
  - pools with `pickPose`;
  - list paging;
  - durable job queue;
  - the RDA engine.

## Original env names (reference only)
- **Backend:** AI_SERVICE_*, GENERATION_MODEL, GENERATION_CONCURRENCY, RDA_WORKER, RDA_IMAGE_MODEL, RDA_TEXT_MODEL, RDA_SHOT_CONCURRENCY, RDA_GARMENT_DETAILS, BACKGROUND_IMAGE_REFS, INITIAL_COMPARE_MODELS.
- **AI service:** NANO_BANANA_API_KEY, OPENAI_API_KEY, NANO_BANANA_MODEL, OPENAI_MODEL, DESCRIBE_VISION_MODEL, GEMINI_API_BASE_URL, PROVIDER_TIMEOUT_SECONDS, OPENAI_TIMEOUT_SECONDS, REQUEST_TIMEOUT_SECONDS, REFERENCE_IMAGE_ALLOWED_HOSTS.
