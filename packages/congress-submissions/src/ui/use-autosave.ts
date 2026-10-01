"use client";

import * as React from "react";

/**
 * The draft autosave (046-design «Autosave»): 1.5 s after the last change,
 * at once on blur (`flush`) and on page hide, the whole latest value, retried
 * on its own after a failure. One save at a time: a change that lands while a
 * save is in flight is saved after it, so the last value always wins.
 */

export type SaveState = "saved" | "saving" | "failed";

export interface Autosave<T> {
  state: SaveState;
  savedAt: Date | null;
  /** Record a change; it is saved after the pause. */
  schedule: (value: T) => void;
  /** Save the pending change now. */
  flush: () => Promise<void>;
}

const DELAY_MS = 1500;
const RETRY_MS = 3000;

export function useAutosave<T>(
  save: (value: T, opts: { keepalive: boolean }) => Promise<unknown>,
): Autosave<T> {
  const [state, setState] = React.useState<SaveState>("saved");
  const [savedAt, setSavedAt] = React.useState<Date | null>(null);
  const pending = React.useRef<{ value: T } | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = React.useRef<Promise<void> | null>(null);
  const saveRef = React.useRef(save);
  saveRef.current = save;

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const run = React.useCallback(
    async (keepalive: boolean): Promise<void> => {
      clear();
      if (inflight.current) await inflight.current;
      const next = pending.current;
      if (!next) return;
      pending.current = null;
      const attempt = (async () => {
        try {
          await saveRef.current(next.value, { keepalive });
          if (pending.current === null) {
            setState("saved");
            setSavedAt(new Date());
          }
        } catch {
          if (pending.current === null) pending.current = next;
          setState("failed");
          clear();
          timer.current = setTimeout(() => void run(false), RETRY_MS);
        }
      })();
      inflight.current = attempt;
      await attempt;
      inflight.current = null;
    },
    [],
  );

  const schedule = React.useCallback(
    (value: T) => {
      pending.current = { value };
      setState("saving");
      clear();
      timer.current = setTimeout(() => void run(false), DELAY_MS);
    },
    [run],
  );

  const flush = React.useCallback(() => run(false), [run]);

  React.useEffect(() => {
    const onHide = () => {
      if (pending.current) void run(true);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onHide();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      clear();
    };
  }, [run]);

  return { state, savedAt, schedule, flush };
}
