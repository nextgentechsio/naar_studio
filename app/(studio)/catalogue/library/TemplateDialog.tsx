"use client";

import { useState } from "react";
import { catalogueApi } from "@/lib/client/catalogue";
import { errorMessage, logRequestError } from "@/lib/client/http";
import {
  CATEGORIES,
  MAX_SHOTS,
  NAME_MAX,
  PROMPT_MAX,
  SHOT_TYPES,
  type PublicAsset,
  type PublicTemplate,
  type ShotDefinition,
  type ShotType,
} from "@/lib/catalogue/shared";
import { Icon } from "@/app/components/ui/Icon";
import { Modal } from "@/app/components/ui/Modal";
import { Alert, Badge, Button, cx, Field, inputClass, Spinner, textareaClass } from "@/app/components/ui/primitives";
import { ReadBlock } from "./AssetDialog";
import { ChipGroup } from "./parts";

// --------------------------------------------------
// CATALOGUE LIBRARY: add, edit or view a template
//
// A template is the recipe of shots a product gets: the
// initial look first (approved by hand), then the rest,
// each with its own prompt and optional pose and
// background.
// --------------------------------------------------

export const SHOT_TYPE_LABELS: Record<ShotType, string> = {
  initial: "Initial look",
  front: "Front",
  back: "Back",
  side: "Side",
  closeup: "Close-up",
  detail: "Detail",
  lifestyle: "Lifestyle",
  full: "Full length",
};

const CATEGORY_OPTIONS = CATEGORIES.map((category) => ({ value: category as string, label: category }));

// A shot being edited, with a key for React that stays
// put while shots move
type Draft = ShotDefinition & { key: string };

let nextKey = 0;
const withKey = (shot: ShotDefinition): Draft => ({ ...shot, key: `shot-${nextKey++}` });

const blankShot = (type: ShotType): ShotDefinition => ({
  // The server names new shots after their type
  id: "",
  label: type === "initial" ? "Initial look" : "",
  type,
  prompt: "",
  poseId: null,
  backgroundId: null,
});

// "Studio basics" → "Studio basics copy"
export function copyOf(template: PublicTemplate): Partial<PublicTemplate> {
  return {
    name: `${template.name} copy`.slice(0, NAME_MAX),
    description: template.description,
    styling: template.styling,
    categories: template.categories,
    shots: template.shots,
  };
}

export default function TemplateDialog({
  template,
  assets,
  canEdit,
  onSaved,
  onDeleted,
  onDuplicate,
  onClose,
}: {
  // null: a new one
  template: PublicTemplate | null;
  // Every asset loaded (for pose and background names)
  assets: PublicAsset[];
  canEdit: boolean;
  onSaved: (template: PublicTemplate) => void;
  onDeleted: (id: string) => void;
  // Makes a copy; resolves once it's saved
  onDuplicate: (template: PublicTemplate) => Promise<void>;
  onClose: () => void;
}) {
  if (!canEdit && template) return <TemplateView template={template} assets={assets} onClose={onClose} />;
  return (
    <TemplateForm
      template={template}
      assets={assets}
      onSaved={onSaved}
      onDeleted={onDeleted}
      onDuplicate={onDuplicate}
      onClose={onClose}
    />
  );
}

function TemplateForm({
  template,
  assets,
  onSaved,
  onDeleted,
  onDuplicate,
  onClose,
}: {
  template: PublicTemplate | null;
  assets: PublicAsset[];
  onSaved: (template: PublicTemplate) => void;
  onDeleted: (id: string) => void;
  onDuplicate: (template: PublicTemplate) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [styling, setStyling] = useState(template?.styling ?? "");
  const [categories, setCategories] = useState<string[]>(template?.categories ?? []);
  const [shots, setShots] = useState<Draft[]>(() =>
    (template?.shots.length ? template.shots : [blankShot("initial"), blankShot("front")]).map(withKey)
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Active ones, plus any already chosen that has since
  // been archived (so the choice still shows)
  const chosen = new Set(shots.flatMap((shot) => [shot.poseId, shot.backgroundId]));
  const pick = (kind: "pose" | "background") =>
    assets.filter((asset) => asset.kind === kind && (asset.status === "active" || chosen.has(asset.id)));
  const poses = pick("pose");
  const backgrounds = pick("background");

  const ready =
    Boolean(name.trim()) && shots.every((shot) => shot.label.trim() && shot.prompt.trim()) && !busy;

  const update = (key: string, patch: Partial<ShotDefinition>) =>
    setShots((list) => list.map((shot) => (shot.key === key ? { ...shot, ...patch } : shot)));

  const move = (index: number, by: -1 | 1) =>
    setShots((list) => {
      const next = [...list];
      [next[index], next[index + by]] = [next[index + by], next[index]];
      return next;
    });

  async function save(close: () => void) {
    setBusy(true);
    setError("");
    const body: Partial<PublicTemplate> = {
      name: name.trim(),
      description,
      styling,
      categories,
      shots: shots.map(({ id, label, type, prompt, poseId, backgroundId }) => ({ id, label, type, prompt, poseId, backgroundId })),
    };
    try {
      const { template: saved } = template
        ? await catalogueApi.updateTemplate(template.id, body)
        : await catalogueApi.createTemplate(body);
      onSaved(saved);
      close();
    } catch (err) {
      logRequestError(err);
      setError(errorMessage(err, "Couldn't save the template."));
      setBusy(false);
    }
  }

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      logRequestError(err);
      setError(errorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  }

  const toggleArchive = () =>
    template &&
    run(async () => {
      const { template: saved } = await catalogueApi.updateTemplate(template.id, {
        status: template.status === "archived" ? "active" : "archived",
      });
      onSaved(saved);
    }, "Couldn't change it.");

  async function remove(close: () => void) {
    if (!template) return;
    if (!window.confirm(`Delete the template "${template.name}"? Products already made from it keep their shots.`)) return;
    await run(async () => {
      await catalogueApi.deleteTemplate(template.id);
      onDeleted(template.id);
      close();
    }, "Couldn't delete the template.");
  }

  return (
    <Modal
      size="xl"
      title={template ? `Edit ${template.name}` : "New template"}
      subtitle={
        template ? (
          <span className="flex flex-wrap gap-1.5">
            {template.builtIn && <Badge tone="accent">Built-in</Badge>}
            {template.status === "archived" && <Badge tone="warning">Archived</Badge>}
          </span>
        ) : (
          "The shots every product made from it gets"
        )
      }
      onClose={onClose}
    >
      {(close) => (
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) void save(close);
          }}
        >
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden border-t border-line p-5">
            {error && (
              <div className="ui-rise">
                <Alert>{error}</Alert>
              </div>
            )}

            <Field label="Name" required>
              {(control) => (
                <input
                  {...control}
                  value={name}
                  maxLength={NAME_MAX}
                  autoComplete="off"
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Studio essentials"
                  className={inputClass}
                />
              )}
            </Field>

            <Field label="Description" hint="Shown when people pick a template.">
              {(control) => (
                <textarea
                  {...control}
                  rows={2}
                  value={description}
                  maxLength={PROMPT_MAX}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="e.g. Clean e-commerce set: front, back, side and a fabric close-up on a plain studio backdrop"
                  className={cx(textareaClass, "resize-y")}
                />
              )}
            </Field>

            <Field label="Styling" hint="Added to every shot's prompt.">
              {(control) => (
                <textarea
                  {...control}
                  rows={3}
                  value={styling}
                  maxLength={PROMPT_MAX}
                  onChange={(event) => setStyling(event.target.value)}
                  placeholder="e.g. Minimal, polished catalogue styling. Hair neat, natural makeup, no extra jewellery. Soft even light."
                  className={cx(textareaClass, "resize-y")}
                />
              )}
            </Field>

            <div className="space-y-1.5">
              <p className="text-sm font-medium text-fg">
                Categories <span className="font-normal text-fg-subtle">· none means any</span>
              </p>
              <ChipGroup
                label="Categories"
                options={CATEGORY_OPTIONS}
                isOn={(value) => categories.includes(value)}
                onToggle={(value) =>
                  setCategories((list) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]))
                }
              />
            </div>

            <div className="space-y-3 border-t border-line pt-5">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium text-fg">Shots</p>
                <span className="text-xs tabular-nums text-fg-subtle">
                  {shots.length} / {MAX_SHOTS}
                </span>
              </div>
              <p className="text-xs leading-5 text-fg-subtle">
                The first shot is the initial look: it&apos;s generated and approved first, then used as the reference for
                the rest. In prompts, <Code>{"{{product}}"}</Code>, <Code>{"{{category}}"}</Code> and{" "}
                <Code>{"{{gender}}"}</Code> are filled in from the product.
              </p>

              <ol className="space-y-3">
                {shots.map((shot, index) => (
                  <li key={shot.key} className="ui-rise rounded-xl border border-line bg-sunken/60 p-3 sm:p-4">
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-raised text-xs font-semibold text-fg-muted">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                        {shot.label.trim() || SHOT_TYPE_LABELS[shot.type]}
                      </span>
                      {index > 0 && (
                        <span className="flex shrink-0">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Move shot ${index + 1} up`}
                            disabled={index === 1}
                            onClick={() => move(index, -1)}
                            className="px-2"
                          >
                            <Icon name="chevronDown" size={14} className="rotate-180" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Move shot ${index + 1} down`}
                            disabled={index === shots.length - 1}
                            onClick={() => move(index, 1)}
                            className="px-2"
                          >
                            <Icon name="chevronDown" size={14} />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Remove shot ${index + 1}`}
                            onClick={() => setShots((list) => list.filter((item) => item.key !== shot.key))}
                            className="px-2 hover:text-danger"
                          >
                            <Icon name="trash" size={14} />
                          </Button>
                        </span>
                      )}
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Field label="Shot name" required>
                        {(control) => (
                          <input
                            {...control}
                            value={shot.label}
                            maxLength={NAME_MAX}
                            autoComplete="off"
                            onChange={(event) => update(shot.key, { label: event.target.value })}
                            placeholder={index === 0 ? "Initial look" : "e.g. Back view"}
                            className={inputClass}
                          />
                        )}
                      </Field>
                      <Field label="Type" hint={index === 0 ? "The first shot is always the initial look." : undefined}>
                        {(control) => (
                          <select
                            {...control}
                            value={shot.type}
                            disabled={index === 0}
                            onChange={(event) => update(shot.key, { type: event.target.value as ShotType })}
                            className={inputClass}
                          >
                            {SHOT_TYPES.filter((type) => (index === 0 ? type === "initial" : type !== "initial")).map((type) => (
                              <option key={type} value={type}>
                                {SHOT_TYPE_LABELS[type]}
                              </option>
                            ))}
                          </select>
                        )}
                      </Field>
                    </div>

                    <div className="mt-3">
                      <Field label="Prompt" required>
                        {(control) => (
                          <textarea
                            {...control}
                            rows={3}
                            value={shot.prompt}
                            maxLength={PROMPT_MAX}
                            onChange={(event) => update(shot.key, { prompt: event.target.value })}
                            placeholder={
                              index === 0
                                ? "e.g. Full-length front view of the {{gender}} model wearing the {{product}}, standing naturally, whole garment visible"
                                : "e.g. Back view of the {{product}}, model turned away, full length, showing the back of the {{category}}"
                            }
                            className={cx(textareaClass, "resize-y")}
                          />
                        )}
                      </Field>
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Field label="Pose" hint="Empty: the product's pose.">
                        {(control) => (
                          <select
                            {...control}
                            value={shot.poseId ?? ""}
                            onChange={(event) => update(shot.key, { poseId: event.target.value || null })}
                            className={inputClass}
                          >
                            <option value="">Product&apos;s choice</option>
                            {poses.map((asset) => (
                              <option key={asset.id} value={asset.id}>
                                {asset.name}
                                {asset.status === "archived" ? " (archived)" : ""}
                              </option>
                            ))}
                          </select>
                        )}
                      </Field>
                      <Field label="Background" hint={index === 0 ? "Empty: the product's background." : "Empty: the initial look's."}>
                        {(control) => (
                          <select
                            {...control}
                            value={shot.backgroundId ?? ""}
                            onChange={(event) => update(shot.key, { backgroundId: event.target.value || null })}
                            className={inputClass}
                          >
                            <option value="">{index === 0 ? "Product's choice" : "Same as initial look"}</option>
                            {backgrounds.map((asset) => (
                              <option key={asset.id} value={asset.id}>
                                {asset.name}
                                {asset.setting ? ` · ${asset.setting}` : ""}
                                {asset.status === "archived" ? " (archived)" : ""}
                              </option>
                            ))}
                          </select>
                        )}
                      </Field>
                    </div>
                  </li>
                ))}
              </ol>

              {shots.length < MAX_SHOTS ? (
                <button
                  type="button"
                  onClick={() => setShots((list) => [...list, withKey(blankShot("front"))])}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong bg-sunken px-3 py-3 text-sm font-medium text-fg-muted transition-colors hover:border-accent hover:text-fg"
                >
                  <Icon name="sparkles" size={15} />
                  Add a shot
                </button>
              ) : (
                <p className="text-center text-xs text-fg-subtle">That&apos;s the most shots a template can have.</p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
            <div className="flex flex-wrap gap-1">
              {template && (
                <>
                  <Button variant="ghost" size="sm" icon="trash" className="text-danger hover:text-danger" disabled={busy} onClick={() => void remove(close)}>
                    Delete
                  </Button>
                  <Button variant="ghost" size="sm" icon={template.status === "archived" ? "undo" : "folder"} disabled={busy} onClick={() => void toggleArchive()}>
                    {template.status === "archived" ? "Unarchive" : "Archive"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="copy"
                    disabled={busy}
                    onClick={() => void run(() => onDuplicate(template), "Couldn't duplicate the template.")}
                  >
                    Duplicate
                  </Button>
                </>
              )}
            </div>
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={!ready}>
                {busy && <Spinner />}
                {template ? "Save changes" : "Create template"}
              </Button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}

function Code({ children }: { children: string }) {
  return <code className="rounded bg-raised px-1 py-0.5 font-mono text-[11px] text-fg">{children}</code>;
}

// Read only, for people who can't edit the library
function TemplateView({
  template,
  assets,
  onClose,
}: {
  template: PublicTemplate;
  assets: PublicAsset[];
  onClose: () => void;
}) {
  const nameOf = (id: string | null) => (id ? assets.find((asset) => asset.id === id)?.name : undefined);

  return (
    <Modal size="xl" title={template.name} subtitle={`${template.shots.length} shot${template.shots.length === 1 ? "" : "s"}`} onClose={onClose}>
      {(close) => (
        <>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden border-t border-line p-5">
            <ReadBlock label="Description" text={template.description} />
            <ReadBlock label="Styling" text={template.styling} />
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-fg-subtle">Categories</p>
              <div className="flex flex-wrap gap-1.5">
                {template.categories.length ? template.categories.map((category) => <Badge key={category}>{category}</Badge>) : <Badge>Any</Badge>}
              </div>
            </div>

            <ol className="space-y-3">
              {template.shots.map((shot, index) => {
                const pose = nameOf(shot.poseId);
                const background = nameOf(shot.backgroundId);
                return (
                  <li key={shot.id} className="rounded-xl border border-line bg-sunken/60 p-3 sm:p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-raised text-xs font-semibold text-fg-muted">
                        {index + 1}
                      </span>
                      <span className="min-w-0 truncate text-sm font-medium text-fg">{shot.label}</span>
                      <Badge tone={shot.type === "initial" ? "accent" : "neutral"}>{SHOT_TYPE_LABELS[shot.type]}</Badge>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap wrap-break-word text-sm leading-6 text-fg-muted">{shot.prompt}</p>
                    {(pose || background) && (
                      <p className="mt-2 flex flex-wrap gap-1.5">
                        {pose && <Badge>Pose: {pose}</Badge>}
                        {background && <Badge>Background: {background}</Badge>}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
          <div className="flex justify-end border-t border-line px-5 py-3">
            <Button variant="ghost" onClick={close}>
              Close
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

