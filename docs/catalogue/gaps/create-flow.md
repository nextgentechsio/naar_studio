# Gap list: Create flow (legacy engine `buildPrompt`)

Audit of the original (`feat/rda-catalog-migration`) against our `catalogue` branch, 2026-11-05.

**Path prefixes:**
- FE = `ai-catalog-frontend:src/features/`
- BE = `ai-catalog-backend:src/`
- PG = `BE services/productGeneration.js`

The original has two engines. Templates with an `rdaSource` use `BE services/rda/**` (~3k lines). Everything here is about the legacy engine.

## 1. Steps

### Details
FE `generate/project-details-form.tsx`, `uploads/*`.
- **Category:** radio cards from the DB (name, examples, outfit type top/bottom/coord), with the copy "Decides which templates and models are available." **Gender** is a radio, "Also filters…".
- **Continue** needs name, category and gender (`project-details.ts:19`).
- **Changing choices resets others:** a new category or gender clears the template and accessories, and a new gender also clears the model (`generate-flow-provider:184-203`).
- **Required photos: front and back** (`slotsMachine.ts:58`). Uploads are disabled until category and gender are set.
- **Extra photos:** 2 per view (front, back, detail), with hints ("border, dupatta, neckline…").
- **Pattern marking:** "Complex print? Mark pattern" (`pattern-marker.tsx`, `pattern-draw-modal.tsx`). The user drags a box; the full-resolution crop goes to `pattern_{view}[_2]`, up to 2 per view.
- **Pairing ×5 and Accessories ×5** uploads with 80-character labels; Footwear ×1.
- **Limits:** 50 MB; png/jpeg/webp only. Photo prep shrinks images in 0.7 steps to ≤4096 px. Uploads have a lightbox.

### Template
FE `catalog-template-step.tsx`, `catalog-template-picker.tsx`.
- **List:** filtered on the server by category and gender, with search (`q`) and pages of 100.
- **Cards:** 2 preview images, "★ Recommended", lock reason, shots in order, shot count.
- **Summary line:** "X generates N shots".
- **Shot filtering:** shots apply only to a matching category and gender (`shotAppliesTo`).

### Model and accessories
FE `model-picker-step.tsx`, `accessory-picker.tsx`.
- **Model tabs:** "For this template" / "All models"; pages of 60; a "Ref" face inset.
- **Auto:** "Naar AI will choose an approved model for every shot." The server picks at random from the template's models (matching gender) and fails if none has a face photo (PG:1612).
- **Accessories:** up to 3 from the template's pool, filtered by category. Copy: "Always described to the model; sent as images where the model has room."
- **No pose or background picker in this step:** those come from the template's pools.
- **Model and size are chosen in a dialog** when generating.

### Initial look
FE `initial-look-step.tsx`, `generation-model-dialog.tsx`.
- **Generation dialog:** opens automatically when entering the step.
  - Model: Nano Banana 2.1 first, then Sunburst.
  - Size: 1K/2K, default 2K.
  - "Additional details (optional)", placeholder "e.g. add big-frame glasses · low angle · hair in a bun".
- **Quick chips:** "Top crop" / "Bottom crop", narrowed by category (`feedback-quick-replies`).
- **"+ Reference image":** feedback and the reference image go to **refinePrompt** (a text model) **which rewrites the prompt** (PG:1100 `resolveRefinedPrompt`, `rda/textSteps.js:205-367`).
- **Info modal:** the prompt, model, duration and references used.
- **Compare lightbox:** a slider against the garment photos.
- **"Past" strip:** shows "Fix: {feedback}".
- **Continue** opens the dialog again for the remaining shots (model, size, feedback and reference apply to all of them) and sends `expected_initial_media_id`.

### Result
FE `product-shot-gallery.tsx`, `result-step/*`.
- **Progress:** "X of Y images ready", polling every 2 s.
- **Crop:** at the shot's export aspect, stored as `shot_crops`; re-crops always start from the original (PG:2336).
- **Download:**
  - rendered to the export width and height with fill, pad (white or edge) or fit;
  - format jpeg/png/webp, "(template default)";
  - "Download all (.zip)", named "as sequence" (`downloadSequence`) or "as shot name".
- **Regenerate modal:**
  - "Fix note" (placeholder "dupatta too loose, wrong border, face changed…");
  - quick chips;
  - model select;
  - an optional reference image **sent as an image** (role `reference`).
- **"Change pose" modal:**
  - tabs "For this shot" / "All poses", with Style and Shot-type filters;
  - "Upload poses";
  - picking a pose regenerates the shot and stores it in `pose_overrides`.
- **Past versions:** "Approve this version" (restore).
- **Pairing after the fact:** upload a pairing, then "Regenerate initial" / "Regenerate all shots".
- **Overrides at approve:** pose and background per shot, validated (PG:3160-3209).

## 2. Prompt and references (PG:646-1078 vs our `prompt.ts`)

### References
- **Tags:** `@imgN` (`imgTag`, PG:1158) and `bindReferencePlaceholders` (PG:1163). Ours says "image N". refinePrompt depends on `@imgN`.
- **Garment photos per shot:** `garmentPrimaryRolesForShot`, `GARMENT_INPUT_PRIMARY_ROLES` and `promptGarmentSlots` (`constants/shotPromptTemplates.js`). A back shot gets only back views, and a front shot never gets the back photo. Later shots are slimmed by `continuityGarmentSlots` (PG:300). Missing views fail (`requiredGarmentSlots`, PG:322).
- **Face crop:** `cropFaceIdentityReference`, 1024² upper-centre, q95, role `face_identity_crop` (PG:1706).
- **Later shots send no model face** (PG:2086). Only regenerate sends everything (`fullInputRefs`).
- **Styling composite:** pairing, footwear and accessories become one side-by-side image (`composeStylingReference`, 1200 px high, q90, labelled; PG:1769-1849). Later shots skip it unless the shot is lifestyle or a regenerate.
- **Cap and packing:** OpenAI 16, Nano Banana 8 (`referenceCapForModel`, PG:1970). `packReferencesToCap` (PG:1934) merges the styling images first, then trims by rank.
- **Order sent** (`orderReferencesForImgTags`, PG:1980): face, main garment, initial look, pose, other garment views, others (pattern, styling, reference), extras, background last.
- **Trim ranks** (`referencesForModel`, PG:2016):

  | Role | Rank |
  |---|---|
  | face | 0 |
  | initial | 0.25 |
  | main garment | 1 |
  | pattern | 1.2 |
  | reference | 1.5 |
  | pose | 2 |
  | background | 2.5 (close-ups), else 4 |
  | other views | 3 |
  | detail extra | 3.2 |
  | styling | 3.5 |
  | other extras | 7 |

- **Roles:**
  - We lack `pattern` (`services/patternReference.js`, MAX_SWATCHES 3), `styling` and `reference`.
  - `pose` exists in the original but is off (`POSE_AS_IMAGE=false`, PG:64).
  - Our `previous` role does not exist in the original.

### Blocks, in order (port word for word)
1. **SKIN DEPTH LOCK** (PG:676), with the measured Fitzpatrick line and a dark-skin line.
2. **SESSION CONTINUITY** (PG:696-722): five sentences, plus the LIFESTYLE EXCEPTION or the SIDE/BACK OVERRIDE, plus the STUDIO SET + COLOR LOCK and light-direction lines.
3. **CANONICAL LOOK** (same as ours).
4. **ROLE MAP** (`roleMapBlock`, PG:436-570). Includes FACE TRANSFER, "NEW environment…" when the background isn't inherited, `GARMENT_SLOT_LABEL` (PG:1080), PATTERN SWATCH, the styling-panels line and the user-reference line.
5. **FACE + SKIN + MAKEUP + HAIR LOCK** (PG:748-772): dark-skin SKIN FINISH and FACE SPLIT for side and rear shots.
6. **BODY PROPORTION LOCK** (PG:776-798), with HEIGHT GROUND TRUTH.
7. **Pose:** with pose images off, `POSE (text):\n{pose.prompt}` goes **after** the purpose and framing lines (PG:918-924). The POSE MATCH and LOCK blocks apply only when the pose is sent as an image (PG:1334-1370).
8. **SHOT + SHOT GUARD** (PG:842-851). `resolveTemplateVariables` (PG:1173) **drops the whole line** when a variable can't be filled. The 11 variables are in `constants/promptVariables.js`.
9. **ACCESSORIES** (PG:853-873): names, "uploaded {label}" lines, hand and wrist rules.
10. **PAIRING (same as Initial Look)**, **PAIRING LAYERING**, **FOOTWEAR (same as Initial Look)** (PG:882-900).
11. **STYLING + STYLING GUARD** (PG:901-909), initial look only. Text from `resolveModelDescription` (`utils/modelDescriptions.js`): a random pick from the template's male/female lists, with Sunburst lists in `services/rda/sunburstDescriptions.js`.
12. **SHOT PURPOSE / framing** (`shotPurposeLine` PG:618, `shotFramingLine` PG:572) for every shot type.
13. **WEAR STYLE LOCK** (`wearStylePromptBlock`, PG:1211): initial look only, ethnic categories only (`wearStyleApplies`, PG:1202). Uses the pose's `wearStyleNotes` first, then the model's.
14. **DYNAMIC** block (PG:943-957) and `constants/dynamicShots.js`.
15. **Lighting:**
    - `lifestyleLightingPromptLine` (PG:1117);
    - `studioIntegrationPromptLine` (PG:1131, with a dark-skin variant);
    - SCENE RECREATION or NATURAL STUDIO (+ FRAME LOCK) (PG:964-1009).
16. **Background notes** (`backgroundScenePromptBlock`, PG:1301). For lifestyle: a 6-line scene brief, plus a bokeh line for close-ups.
17. **Product notes.**
18. **GARMENT FIT** (`garmentFitDirection`, PG:1226-1277): saree (blouse lock or restyle via `stylingAllowsBlouseChange`), salwar, coord/kurta/lehenga, generic.
19. **Finish** and **Rendering** lines (PG:1033-1050), 4 variants each.
20. **Reference quality** (`constants/catalogReferenceQuality.js`: REFERENCE_CORE + SHOT_REFERENCE + LOOK_REFERENCE). Lifestyle shots add LIFESTYLE COLOR FIDELITY + GARMENT DETAILS.
21. **GARMENT COLOR — DO NOT CHANGE**, the long version (PG:1071).
22. **OUTPUT_SHARPNESS** (same as ours).

### Other differences
- **Length:** the original has **no length budget**. Ours caps at 6000 characters.
- **Feedback:** the original rewrites the prompt with refinePrompt. Ours appends a CORRECTION block and the previous image.
- **OpenAI quality:** high for the initial look, else the shot's `generationQuality` (default medium), with `input_fidelity` high (legacy path).
- **Pose choice:** `pickPose` (PG:1380) picks at random from the shot's eligible poses, by tag, `poseStyle` and gender. It avoids the initial look's pose and poses used by other shots (PG:3277-3295).
- **Background choice:** `resolveShotBackground` / `loadBackgroundPool` (PG:1497-1590): inherit, random from pool, default, category filter.

## 3. Post-processing and stored data
- **Output processing:** `processGeneratedImage` (`utils/imageProcessing.js`) cover-resizes to the export size (default 1080x1440), JPEG q95 mozjpeg, plus a 480 px thumbnail at q78.
- **Skin depth:** `estimateSkinDepthFromImage`. Mean brightness of the central oval of a 96² image; cut-offs <85, <115, <145, <175; `isDark` below 145.
- **Per product, `outputImages`:**
  - `initial`, `approved`;
  - **`pose_id`, `background_id`, `model_id`, `accessory_ids`: locked at the initial look and replayed for later shots** (PG:2632-2650, 3264-3275);
  - `traces[shot]` = {prompt, references[{role, media_id, sent}], model, durationMs, feedback};
  - `generation_history`;
  - `shot_crops`, `initial_candidates`, `generation_model`, `pose_overrides`, `background_overrides`.
- **Other product fields:** `inputLabels`; `export_config` (PG:338).
- **Failure log:** ProductGenerationFailure (PG:2226).
- **Statuses:** draft, generating, completed, failed, partial (PG:180).

## 4. Priorities
- **P0:**
  - the prompt, word for word (L);
  - the reference pipeline (M-L);
  - skin depth (S);
  - lock and replay of the initial look's choices, plus traces and the Info modal (M);
  - refinePrompt (M);
  - upload slots (M);
  - template pools, model descriptions, quality, export settings and shot types (L);
  - output processing and OpenAI quality (S-M).
- **P1:**
  - pattern swatches;
  - the generation dialog flow;
  - crop, export download, zip;
  - the pose picker modal and approve-time overrides;
  - compare lightbox;
  - DB categories and filtering;
  - failed / partial statuses.
- **P2:**
  - upload your own initial look;
  - pairing after the fact;
  - photo prep;
  - model tabs;
  - the RDA engine.
