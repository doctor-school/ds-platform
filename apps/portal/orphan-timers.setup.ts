/**
 * #434 — orphan-`setTimeout` tracking for the portal's jsdom suites.
 *
 * SIBLING: `@ds/design-system` adopted this guard verbatim in #441
 * (`packages/design-system/orphan-timers.setup.ts`). The two copies are siblings —
 * an upstream `input-otp` change (or a rework of this guard) must update BOTH.
 *
 * Why: `input-otp@1.4.2` scheduled a 0/10/50ms `setTimeout` triple on every
 * value/focus change (its minified `syncTimeouts` helper) and returned NO cleanup
 * from the scheduling effect, so timers scheduled by a suite's final keystrokes
 * outlived the file's JSDOM environment; the late callback then reaches React's
 * `dispatchSetState` → `resolveUpdatePriority`, which touches the torn-down
 * `window` and red-lights the whole `unit` job with an intermittent
 * `ReferenceError: window is not defined` (same class as #405, different timer).
 * `input-otp@1.5.0` fixed the leak upstream (the scheduling effect now clears its
 * own handles), so the guard is no longer tolerating a known defect — it stays as
 * a standing class-guard that keeps the whole class of leak deterministic instead
 * of racing the teardown.
 *
 * How: `installOrphanTimerTracking()` (called once from vitest.setup.ts, BEFORE
 * any test can snapshot the globals) wraps the environment's `setTimeout` /
 * `clearTimeout` to keep a live map of pending handles plus the stack of each
 * scheduling site. `flushOrphanTimers()` (called from the setup-level global
 * `afterEach`, i.e. after RTL `cleanup()` has unmounted everything) defuses every
 * still-pending handle and reports it as a `foreign` leak — a timer OUR code (or a
 * test) left past its unmount. The setup afterEach turns these into a hard,
 * locally attributable failure (the #405/#408 class-guard pattern) instead of an
 * intermittent CI teardown flake. There is no tolerated-defect bucket: since
 * `input-otp@1.5.0` no dependency is allowed to leak a timer past unmount.
 *
 * Fake timers stay orthogonal: `vi.useFakeTimers()` swaps `globalThis.setTimeout`
 * for the mock (scheduling under it is controlled and untracked) and
 * `vi.useRealTimers()` restores this wrapper, because the wrapper IS the "real"
 * timer the mock snapshots.
 */

export interface OrphanTimer {
  /** Scheduling-site stack captured at `setTimeout` call time. */
  stack: string;
  /** The delay the orphan was scheduled with (undefined = 0-ish). */
  delay: number | undefined;
}

type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

const pending = new Map<TimerHandle, OrphanTimer>();

let installed = false;
let originalSetTimeout: typeof globalThis.setTimeout;
let originalClearTimeout: typeof globalThis.clearTimeout;

export function installOrphanTimerTracking(): void {
  if (installed) return;
  installed = true;

  originalSetTimeout = globalThis.setTimeout.bind(globalThis);
  originalClearTimeout = globalThis.clearTimeout.bind(globalThis);

  const wrappedSetTimeout = (
    callback: unknown,
    delay?: number,
    ...args: unknown[]
  ): TimerHandle => {
    // Non-function callbacks (the legacy string form) pass through untracked.
    if (typeof callback !== "function") {
      return originalSetTimeout(callback as never, delay, ...(args as never[]));
    }
    const stack = new Error().stack ?? "";
    const handle: TimerHandle = originalSetTimeout(
      function (this: unknown, ...callbackArgs: unknown[]) {
        pending.delete(handle);
        return (callback as (...a: unknown[]) => unknown).apply(this, callbackArgs);
      },
      delay,
      ...(args as never[]),
    );
    pending.set(handle, { stack, delay });
    return handle;
  };

  const wrappedClearTimeout = (handle?: TimerHandle): void => {
    if (handle !== undefined) pending.delete(handle);
    originalClearTimeout(handle);
  };

  globalThis.setTimeout = wrappedSetTimeout as typeof globalThis.setTimeout;
  globalThis.clearTimeout = wrappedClearTimeout as typeof globalThis.clearTimeout;
}

/**
 * Defuse every still-pending tracked timeout and report what was found.
 * Idempotent per accumulation: the pending map is drained on every call.
 */
export function flushOrphanTimers(): { foreign: OrphanTimer[] } {
  const foreign: OrphanTimer[] = [];
  for (const [handle, orphan] of pending) {
    originalClearTimeout(handle);
    foreign.push(orphan);
  }
  pending.clear();
  return { foreign };
}
