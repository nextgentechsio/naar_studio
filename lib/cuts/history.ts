// --------------------------------------------------
// NAAR CUTS: UNDO AND REDO
//
// Whole projects are kept (edits return new objects that
// share everything unchanged, so this is cheap). Steps
// with the same `group` in a row (one drag, one slider
// being moved) become a single undo.
// --------------------------------------------------

export const HISTORY_LIMIT = 200;

export type History<T> = {
  past: T[];
  present: T;
  future: T[];
  // The group of the last step, while it may still merge
  group: string | null;
};

export function startHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], group: null };
}

export function push<T>(history: History<T>, next: T, group: string | null = null): History<T> {
  if (next === history.present) return history;

  // Same gesture as the last step: replace it
  if (group !== null && group === history.group) {
    return { ...history, present: next, future: [] };
  }

  const past = [...history.past, history.present];
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
  return { past, present: next, future: [], group };
}

// Ends the current gesture: the next step starts anew
export function seal<T>(history: History<T>): History<T> {
  return history.group === null ? history : { ...history, group: null };
}

export function undo<T>(history: History<T>): History<T> {
  if (!history.past.length) return history;
  const previous = history.past[history.past.length - 1];
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
    group: null,
  };
}

export function redo<T>(history: History<T>): History<T> {
  if (!history.future.length) return history;
  const [next, ...rest] = history.future;
  return { past: [...history.past, history.present], present: next, future: rest, group: null };
}
