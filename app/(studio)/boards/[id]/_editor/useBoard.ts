"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyWithInverse, patchItem, type BoardItem, type BoardOp, type ItemMap, type ItemPatch } from "@/lib/boards/shared";
import { saveBoardOps } from "@/lib/client/boards";
import { errorMessage } from "@/lib/client/http";

// --------------------------------------------------
// A BOARD'S STATE IN THE BROWSER
//
// Items, plus "drafts": changes shown while dragging but
// not yet made (a drag ends in one commit, one undo step).
// Every commit is applied here at once, kept for undo,
// and queued; the queue is saved in the background in
// order, retried until it goes through.
//
// The live copy is a ref (event handlers read it); each
// change publishes a new Map for rendering.
// --------------------------------------------------

export type SaveState = "saved" | "saving" | "retrying";

const SAVE_DELAY_MS = 400;
const MAX_UNDO = 200;
const BATCH = 400;

type Step = { ops: BoardOp[]; inverse: BoardOp[] };

export function useBoard(boardId: string, initial: BoardItem[]) {
  const liveRef = useRef<ItemMap>(new Map(initial.map((item) => [item.id, item])));
  const [stored, setStored] = useState<ItemMap>(() => new Map(initial.map((item) => [item.id, item])));
  const [drafts, setDrafts] = useState<Map<string, ItemPatch>>(new Map());
  const undoRef = useRef<Step[]>([]);
  const redoRef = useRef<Step[]>([]);
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const queueRef = useRef<BoardOp[]>([]);
  const sendingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRef = useRef<() => void>(() => undefined);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState("");

  const publish = () => {
    setStored(new Map(liveRef.current));
    setHistory({ undo: undoRef.current.length, redo: redoRef.current.length });
  };

  // ---------- Saving ----------

  useEffect(() => {
    flushRef.current = async () => {
      if (sendingRef.current || !queueRef.current.length) return;
      sendingRef.current = true;
      setSaveState("saving");
      const batch = queueRef.current.slice(0, BATCH);
      try {
        await saveBoardOps(boardId, batch);
        queueRef.current = queueRef.current.slice(batch.length);
        setSaveError("");
        setSaveState(queueRef.current.length ? "saving" : "saved");
        sendingRef.current = false;
        if (queueRef.current.length) flushRef.current();
      } catch (error) {
        sendingRef.current = false;
        setSaveState("retrying");
        setSaveError(errorMessage(error, "Couldn't save. Retrying…"));
        timerRef.current = setTimeout(() => flushRef.current(), 3000);
      }
    };
  }, [boardId]);

  const schedule = useCallback(() => {
    setSaveState((state) => (state === "retrying" ? state : "saving"));
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => flushRef.current(), SAVE_DELAY_MS);
  }, []);

  // Leaving the page: send what's left, even as it closes
  useEffect(() => {
    const leave = () => {
      if (queueRef.current.length) void saveBoardOps(boardId, queueRef.current.slice(0, BATCH), true).catch(() => undefined);
    };
    const warn = (event: BeforeUnloadEvent) => {
      if (queueRef.current.length) event.preventDefault();
    };
    window.addEventListener("pagehide", leave);
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("beforeunload", warn);
      leave();
    };
  }, [boardId]);

  // ---------- Changing ----------

  const commit = useCallback(
    (ops: BoardOp[], options: { undoable?: boolean } = {}) => {
      if (!ops.length) return;
      const inverse = applyWithInverse(liveRef.current, ops);
      if (options.undoable !== false) {
        undoRef.current.push({ ops, inverse });
        if (undoRef.current.length > MAX_UNDO) undoRef.current.shift();
        redoRef.current = [];
      }
      queueRef.current.push(...ops);
      setDrafts(new Map());
      publish();
      schedule();
    },
    [schedule]
  );

  const undo = useCallback(() => {
    const step = undoRef.current.pop();
    if (!step) return;
    applyWithInverse(liveRef.current, step.inverse);
    redoRef.current.push(step);
    queueRef.current.push(...step.inverse);
    publish();
    schedule();
  }, [schedule]);

  const redo = useCallback(() => {
    const step = redoRef.current.pop();
    if (!step) return;
    applyWithInverse(liveRef.current, step.ops);
    undoRef.current.push(step);
    queueRef.current.push(...step.ops);
    publish();
    schedule();
  }, [schedule]);

  // The current items, for event handlers
  const getStored = useCallback(() => liveRef.current, []);

  // The items as shown: stored, with drafts over them
  const items = useMemo((): ItemMap => {
    if (!drafts.size) return stored;
    const map = new Map(stored);
    for (const [id, set] of drafts) {
      const item = map.get(id);
      const next = item && patchItem(item, set);
      if (next) map.set(id, next);
    }
    return map;
  }, [drafts, stored]);

  return {
    items,
    getStored,
    setDrafts,
    commit,
    undo,
    redo,
    canUndo: history.undo > 0,
    canRedo: history.redo > 0,
    saveState,
    saveError,
  };
}

export type BoardStore = ReturnType<typeof useBoard>;
