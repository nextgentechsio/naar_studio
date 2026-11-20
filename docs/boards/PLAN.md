# Naar Boards: plan

**Status (20 Nov 2026):** phase 1 is built and verified in Chrome (boards list; editor with stickies, text, shapes, connectors, frames, pictures and videos; pan/zoom, selection, snapping, undo, shortcuts, autosave). Phases 2–4 are not started; live collaboration needs a Liveblocks key.

A FigJam-style whiteboard inside Naar Studio, built on our own canvas so it looks and behaves like the rest of the studio. One board can be a moodboard of outputs, a shot plan, a brainstorm, or a client presentation, and the team can work on it together.

## Decisions (user, 20 Nov 2026)

| Question | Decision |
|---|---|
| What boards are for | **All of:** moodboards from outputs, shot and campaign planning, brainstorms and feedback, client presentations |
| Working together | **Live:** see each other's cursors and edits as they happen |
| Generating | **From the board:** select images, write a prompt, and the result lands on the board |
| Canvas engine | **Our own** (no tldraw or Excalidraw) |

## Design principles

1. **Studio first, not a drawing app.** The board's main objects are studio things: outputs, elements, generation cards, frames. Sticky notes, text, shapes and arrows support them.
2. **One canvas, many uses.** There are no separate "moodboard" and "storyboard" products. **Frames** do the work: a frame can be a mood cluster, a shot (numbered, in order), or a slide when presenting.
3. **Feels like FigJam.**
   - Bottom-centre toolbar.
   - Infinite canvas with smooth pan and zoom (trackpad, pinch, space-drag).
   - A contextual bar above the selection.
   - Multiplayer cursors with names.
   - Everything undoable.
4. **Fast with hundreds of images.** Items off screen aren't drawn, and images load as thumbnails until you zoom in.
5. **Nothing breaks later.** Media placed on a board is copied into the board's own storage. Output retention, a deleted element or a revoked permission can't leave holes (the same rule as Naar Cuts).

## What's on a board

| Item | Does |
|---|---|
| **Image / video** | From History, Elements, the media library or an upload. Shows the source (model, prompt) on hover. |
| **Generation card** | A prompt, a model and input images (linked items). Shows Running, then its output, the cost and "Run again". Its output also lands in History. |
| **Frame** | A titled area that groups items. In a storyboard, frames are numbered shots. In presentation mode, each frame is a slide. |
| **Sticky note** | Coloured note with text, author and reactions. |
| **Text** | A heading or paragraph. |
| **Shape** | Rectangle, ellipse, diamond; fill, stroke, text inside. |
| **Connector** | An arrow between two items that follows them when they move; optional label. |
| **Comment pin** | A thread anchored to a point or an item (phase 4). |

## Canvas engine (ours)

- **Rendering:** items are DOM elements inside one "world" layer that moves with a CSS transform (pan and zoom). DOM handles text editing, images, video and accessibility well. Connectors and selection outlines are drawn on an SVG layer. Only items in or near the viewport are mounted.
- **Interaction:** a small state machine of tools (select, hand, sticky, text, shape, connector, frame) on pointer events, with:
  - drag-select;
  - shift to add to a selection;
  - resize handles;
  - snapping to other items' edges and centres, with guides;
  - nudging with the arrow keys;
  - copy, paste and duplicate;
  - bring to front and send to back;
  - grouping into frames;
  - zoom to fit or to the selection.
- **Undo/redo:** every change is an operation, so undo plays back the inverse. The same operations travel over the network.
- **Keyboard:**

  | Key | Tool / action |
  |---|---|
  | V | Select |
  | H | Hand (pan) |
  | S | Sticky note |
  | T | Text |
  | R | Rectangle |
  | O | Ellipse |
  | L | Connector |
  | F | Frame |
  | G | Generate |
  | ⌘Z / ⇧⌘Z | Undo / redo |
  | ⌘D | Duplicate |
  | ⌫ | Delete |
  | ⇧1 | Zoom to fit |
  | ⇧2 | Zoom to selection |

## Data (own collections, own storage)

- **`boards`:** `{ _id, name, ownerId, members: [{ userId, role: "editor" | "viewer" }], shareLink?: { token, enabled }, thumbnailUrl, createdAt, updatedAt }`
- **`boardItems`:** one document per item: `{ _id, boardId, type, x, y, w, h, z, rotation, frameId?, data, version, updatedAt, updatedBy }`. One document per item lets two people edit different items at once without conflict.
- **`boardAssets`:** media copied into Blob `boards/<boardId>/…`, deduplicated per board, the same pattern as Naar Cuts.

Indexes are created in `lib/boards/db.ts`. `lib/db/mongodb.ts` isn't touched.

## Sync: how "live" works

The board's data always lives in **our** MongoDB. Live collaboration is a fast relay on top:

1. **Saving:** every edit is sent as small operations ("move item A", "change sticky B's text") to `POST /api/boards/:id/ops`. The server applies each one if the item's `version` matches. If two people change the same item at the same moment, the last edit wins at field level (one person's colour and another's text both survive).
2. **Live relay:** to make others see it instantly, a relay broadcasts the same operations and everyone's cursor position. Vercel can't hold open connections, so the relay is a small external service:
   - **Recommended:** **Liveblocks**, used only for presence and broadcast, never as storage. About $0.03 per active board per month, with 500 boards a month free. It needs a Liveblocks account and key, added later.
   - **Until the key exists**, boards stay in sync by checking `GET /api/boards/:id/changes?since=…` every 1–2 seconds. That's near-live, cursors not included, and it works today with nothing extra.

Both use the same operations, so switching on Liveblocks is configuration, not a rewrite.

## Generating from a board

- **How it works:**
  1. Select images, press **Generate** (G).
  2. A panel opens beside the selection with project, model (Replicate, Higgsfield or ElevenLabs), prompt and settings. It reuses the Create pages' model list and the shared start functions (`lib/{replicate,higgsfield,elevenlabs}/start.ts`).
  3. A **generation card** appears next to the selection, linked to its inputs by connectors. It runs, then shows the output.
- **Tracking:** it's an ordinary run, in History, costed and tracked to the user who started it and the chosen project.
- **Cards share the run:** every collaborator's card shows the same run, so it isn't started twice.

## Sharing and clients

- **Members:** board owner, editors, viewers. Admins can see every board.
- **Client link** (phase 4): a read-only link with an unguessable token. No login, no costs shown. Clients can add comment pins and reactions if the owner allows it.
- **Presentation mode:** full screen, one frame after another.

## Phases

1. **Canvas and boards (single person)** — done:
   - `/boards` list (create, rename, duplicate, delete, thumbnails);
   - the editor with stickies, text, shapes, connectors, frames and images;
   - media from History, Elements, the library and uploads, copied into the board;
   - pan and zoom, selection, snapping, undo, shortcuts, autosave.
2. **Together:**
   - members and roles;
   - operations with versions;
   - near-live sync by polling;
   - then the Liveblocks relay with live cursors and avatars, once there's a key;
   - "who's here" in the top bar.
3. **Generate from the board:** generation cards, connectors to inputs, run again, storyboard numbering of frames, send to Naar Cuts.
4. **Feedback and clients:** comment pins and threads, reactions and votes on stickies, presentation mode, client read-only link, PNG/PDF export of a frame.

## Testing

- **Unit:** geometry (hit-testing, snapping, bounds, zoom maths), operations (apply, invert for undo, merge on conflict), frame membership, connector routing.
- **Integration** (fake providers, MongoMemoryServer):
  - board CRUD and permissions (owner, editor, viewer, others get 404);
  - operations with version conflicts;
  - changes since a time;
  - media copied into `boards/`;
  - generation from a board, tracked like any run;
  - client link read-only.
- **Browser:** build a moodboard from History, draw, undo, reload; two browser windows editing one board; generate from the board.

## Isolation

- **Where the code lives:** `lib/boards/`, `app/(studio)/boards/`, `app/api/boards/`, and `tests/*/boards-*`.
- **Small edits elsewhere:** outside those folders, only a nav item and icons change.
- **Reuse:** start functions, the model lists and the media pickers are reused by import.
