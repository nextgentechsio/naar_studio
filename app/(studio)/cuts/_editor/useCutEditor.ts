"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { errorMessage, logRequestError } from "@/lib/client/http";
import {
  addElementAsset,
  addGenerationAsset,
  getCut,
  listAssets,
  saveCut,
  updateAsset,
  uploadCutFile,
} from "@/lib/cuts/client";
import { push, redo as redoStep, seal as sealStep, startHistory, undo as undoStep, type History } from "@/lib/cuts/history";
import { measureAsset } from "@/lib/cuts/media";
import type { PlayerAsset } from "@/lib/cuts/playback";
import {
  IMAGE_DEFAULT_SECONDS,
  freeTrack,
  insertClip,
  newClip,
  projectDuration,
  readProject,
  trackKindFor,
  type AssetInfo,
  type ClipType,
  type Project,
} from "@/lib/cuts/timeline";
import type { CutAsset } from "@/lib/cuts/types";

// --------------------------------------------------
// NAAR CUTS: EDITOR STATE
//
// The cut, its files and the timeline with undo/redo.
// Every change is saved on its own, a moment after the
// last edit, with the version it was based on, so a
// second tab can't silently overwrite it.
// --------------------------------------------------

export type SaveState = "saved" | "pending" | "saving" | "error" | "conflict";

export type Busy = { id: string; label: string; progress: number | null };

// What can be dropped on the timeline from the media pool
export type MediaSource =
  | { type: "generation"; id: string; kind: "video" | "image" | "audio"; name: string }
  | { type: "element"; url: string; kind: "video" | "image" | "audio"; name: string }
  | { type: "asset"; assetId: string }
  | { type: "file"; file: File };

const SAVE_DELAY_MS = 1200;

export function useCutEditor(cutId: string, userId: string) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [name, setName] = useState("");
  const [history, setHistory] = useState<History<Project>>(() => startHistory(readProject(null)));
  const [assets, setAssets] = useState<CutAsset[]>([]);
  const [save, setSave] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState<Busy[]>([]);
  const [notice, setNotice] = useState("");

  const project = history.present;
  const versionRef = useRef(1);
  const savedRef = useRef<Project | null>(null);
  const savedNameRef = useRef("");
  const projectRef = useRef(project);
  const assetsRef = useRef(assets);
  const nameRef = useRef(name);
  // The latest values, for callbacks and timers
  useLayoutEffect(() => {
    projectRef.current = project;
    assetsRef.current = assets;
    nameRef.current = name;
  }, [project, assets, name]);

  // ---------- Load ----------

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cut, files] = await Promise.all([getCut(cutId), listAssets(cutId)]);
        if (cancelled) return;
        const loaded = readProject(cut.timeline);
        versionRef.current = cut.version;
        savedRef.current = loaded;
        savedNameRef.current = cut.name;
        setName(cut.name);
        setHistory(startHistory(loaded));
        setAssets(files);
      } catch (error) {
        logRequestError(error);
        if (!cancelled) setLoadError(errorMessage(error, "Couldn't open this cut."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cutId]);

  // ---------- Save ----------

  const savingRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (savingRef.current) return;
    const current = projectRef.current;
    const currentName = savedNameRef.current === nameRef.current ? undefined : nameRef.current;
    if (current === savedRef.current && currentName === undefined) {
      setSave("saved");
      return;
    }

    savingRef.current = true;
    setSave("saving");
    try {
      const posterUrl = assetsRef.current.find((asset) => asset.kind === "image")?.url;
      const cut = await saveCut(cutId, {
        version: versionRef.current,
        timeline: current,
        durationMs: Math.round((projectDuration(current) / current.fps) * 1000),
        ...(currentName !== undefined ? { name: currentName } : {}),
        ...(posterUrl ? { posterUrl } : {}),
      });
      versionRef.current = cut.version;
      savedRef.current = current;
      savedNameRef.current = cut.name;
      setSaveError("");
      setSave(projectRef.current === current && nameRef.current === cut.name ? "saved" : "pending");
    } catch (error) {
      logRequestError(error);
      const message = errorMessage(error, "Couldn't save.");
      setSaveError(message);
      setSave(/another tab/i.test(message) ? "conflict" : "error");
    } finally {
      savingRef.current = false;
    }
  }, [cutId]);

  useEffect(() => {
    if (loading || loadError || save === "conflict") return;
    if (project === savedRef.current && name === savedNameRef.current) return;
    setSave((state) => (state === "saving" ? state : "pending"));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [project, name, loading, loadError, save, flush]);

  // A save still waiting when the page is left
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (projectRef.current !== savedRef.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  // ---------- Timeline edits ----------

  const edit = useCallback((change: (project: Project) => Project, group: string | null = null) => {
    setHistory((current) => push(current, change(current.present), group));
  }, []);

  const seal = useCallback(() => setHistory((current) => sealStep(current)), []);
  const undo = useCallback(() => setHistory((current) => undoStep(current)), []);
  const redo = useCallback(() => setHistory((current) => redoStep(current)), []);

  // ---------- Files ----------

  const assetMap = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);

  const playerAssets = useMemo(
    () => new Map<string, PlayerAsset>(assets.map((asset) => [asset.id, { url: asset.url, kind: asset.kind }])),
    [assets]
  );

  const assetInfo = useCallback(
    (assetId: string | null): AssetInfo | null => {
      const asset = assetId ? assetMap.get(assetId) : undefined;
      if (!asset) return null;
      return { kind: asset.kind, durationSeconds: asset.durationMs ? asset.durationMs / 1000 : null };
    },
    [assetMap]
  );

  const upsertAsset = useCallback((asset: CutAsset) => {
    setAssets((current) =>
      current.some((item) => item.id === asset.id)
        ? current.map((item) => (item.id === asset.id ? asset : item))
        : [...current, asset]
    );
  }, []);

  // Measure each file once (length, size, waveform)
  const measuring = useRef(new Set<string>());
  useEffect(() => {
    for (const asset of assets) {
      const needs =
        asset.kind === "image"
          ? !asset.width
          : !asset.durationMs || (!asset.peaks && asset.kind !== "export");
      if (!needs || measuring.current.has(asset.id)) continue;
      measuring.current.add(asset.id);
      void measureAsset(asset)
        .then(async (measured) => {
          if (!Object.keys(measured).length) return;
          upsertAsset(await updateAsset(cutId, asset.id, measured));
        })
        .catch((error) => logRequestError(error));
    }
  }, [assets, cutId, upsertAsset]);

  const track = useCallback((label: string) => {
    const id = `${Date.now()}${Math.random()}`;
    setBusy((current) => [...current, { id, label, progress: null }]);
    return {
      progress: (progress: number | null) =>
        setBusy((current) => current.map((item) => (item.id === id ? { ...item, progress } : item))),
      done: () => setBusy((current) => current.filter((item) => item.id !== id)),
    };
  }, []);

  // The project's own copy of a file from the media pool
  const resolveAsset = useCallback(
    async (source: MediaSource): Promise<CutAsset> => {
      if (source.type === "asset") {
        const asset = assetsRef.current.find((item) => item.id === source.assetId);
        if (!asset) throw new Error("That file is no longer in this cut.");
        return asset;
      }

      const job = track(
        source.type === "file" ? `Uploading ${source.file.name}` : `Copying ${source.name || "file"} into this cut`
      );
      try {
        let asset: CutAsset;
        if (source.type === "generation") asset = await addGenerationAsset(cutId, source.id);
        else if (source.type === "element") asset = await addElementAsset(cutId, source.url);
        else asset = await uploadCutFile(userId, cutId, source.file, "upload", (percent) => job.progress(percent));

        // Its length before it goes on the timeline
        if (!asset.durationMs && (asset.kind === "video" || asset.kind === "audio")) {
          const measured = await measureAsset(asset);
          if (measured.durationMs || measured.width) asset = await updateAsset(cutId, asset.id, measured);
        }
        upsertAsset(asset);
        return asset;
      } finally {
        job.done();
      }
    },
    [cutId, userId, track, upsertAsset]
  );

  // Puts a file on the timeline at `frame`: on `trackId`
  // if it fits there, else the first free matching track
  const place = useCallback(
    async (source: MediaSource, frame: number, trackId?: string) => {
      try {
        const asset = await resolveAsset(source);
        if (asset.kind === "export") {
          setNotice("Exports can't go back on the timeline; download them instead.");
          return null;
        }
        const type: ClipType = asset.kind;
        const kind = trackKindFor(type);
        const seconds = type === "image" ? IMAGE_DEFAULT_SECONDS : (asset.durationMs ?? 5000) / 1000;
        const start = Math.max(0, Math.round(frame));
        const duration = Math.max(1, Math.floor(seconds * projectRef.current.fps));
        const clip = newClip({ trackId: "", type, assetId: asset.id, start, duration, name: asset.name });

        // Dropped on a track: there (over what's under it).
        // Otherwise the first track free at that time.
        edit((project) => {
          const dropped = project.tracks.find((item) => item.id === trackId && item.kind === kind && !item.locked);
          const target = dropped ? { project, trackId: dropped.id } : freeTrack(project, kind, start, start + duration);
          return insertClip(target.project, { ...clip, trackId: target.trackId });
        });
        return clip.id;
      } catch (error) {
        logRequestError(error);
        setNotice(errorMessage(error, "Couldn't add that file."));
        return null;
      }
    },
    [resolveAsset, edit]
  );

  // Adds files to the project without placing them
  const importFiles = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        try {
          await resolveAsset({ type: "file", file });
        } catch (error) {
          logRequestError(error);
          setNotice(errorMessage(error, `Couldn't upload ${file.name}.`));
        }
      }
    },
    [resolveAsset]
  );

  const removeAssetLocal = useCallback((assetId: string) => {
    setAssets((current) => current.filter((asset) => asset.id !== assetId));
  }, []);

  return {
    loading,
    loadError,
    name,
    setName,
    project,
    history,
    edit,
    seal,
    undo,
    redo,
    assets,
    assetMap,
    playerAssets,
    assetInfo,
    upsertAsset,
    removeAssetLocal,
    place,
    importFiles,
    save,
    saveError,
    flush,
    busy,
    track,
    notice,
    setNotice,
  };
}

export type CutEditor = ReturnType<typeof useCutEditor>;
