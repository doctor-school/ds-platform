/**
 * #434 — orphan-`setTimeout` tracking for the portal's jsdom suites.
 *
 * Why: `input-otp@1.4.2` schedules a 0/10/50ms `setTimeout` triple on every
 * value/focus change (its minified `syncTimeouts` helper) and returns NO cleanup
 * from the scheduling effect, so timers scheduled by a suite's final keystrokes
 * outlive the file's JSDOM environment; the late callback then reaches React's
 * `dispatchSetState` → `resolveUpdatePriority`, which touches the torn-down
 * `window` and red-lights the whole `unit` job with an intermittent
 * `ReferenceError: window is not defined` (same class as #405, different timer).
 * Upstream offers no newer release (1.4.2 is latest), so the environment defends
 * itself deterministically instead of racing the teardown.
 *
 * How: `installOrphanTimerTracking()` (called once from vitest.setup.ts, BEFORE
 * any test can snapshot the globals) wraps the environment's `setTimeout` /
 * `clearTimeout` to keep a live map of pending handles plus the stack of each
 * scheduling site. `flushOrphanTimers()` (called from the setup-level global
 * `afterEach`, i.e. after RTL `cleanup()` has unmounted everything) defuses every
 * still-pending handle and classifies it by its scheduling stack:
 *
 *   - `known`   — the documented upstream defect (an `input-otp` frame in the
 *                 stack): defused silently; once unmounted the sync tick is dead
 *                 code by definition.
 *   - `foreign` — anything else: a timer OUR code (or a test) leaked past its
 *                 unmount. The setup afterEach turns these into a hard, locally
 *                 attributable failure (the #405/#408 class-guard pattern) instead
 *                 of an intermittent CI teardown flake.
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

/** Frames that mark the documented upstream defect (see module header). */
const KNOWN_UPSTREAM = /input-otp/;

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
export function flushOrphanTimers(): { known: OrphanTimer[]; foreign: OrphanTimer[] } {
  const known: OrphanTimer[] = [];
  const foreign: OrphanTimer[] = [];
  for (const [handle, orphan] of pending) {
    originalClearTimeout(handle);
    (KNOWN_UPSTREAM.test(orphan.stack) ? known : foreign).push(orphan);
  }
  pending.clear();
  return { known, foreign };
}
