export interface RunBootstrapDeps {
  /** Ends the process; `process.exit` in production. */
  exit: (code: number) => void;
  /** Drains queued error events; `Sentry.flush` in production. */
  flush: (timeoutMs: number) => Promise<unknown>;
  log: (message: string, error: unknown) => void;
  /** Records the failure in error monitoring; `Sentry.captureException` in production. */
  capture: (error: unknown) => void;
  /** Upper bound on the flush wait, so a dead transport never blocks the exit. */
  flushTimeoutMs?: number;
}

const DEFAULT_FLUSH_TIMEOUT_MS = 2000;

/**
 * Runs the api boot and turns a failure into a process exit (#3412).
 *
 * A boot that rejects (`createApiApplication`, a module's `onModuleInit` inside
 * `listen`, `listen` itself) must not leave a process that is alive with no HTTP
 * listener. Node only exits on an unhandled rejection when no one else handles
 * it, and the Sentry SDK's OnUnhandledRejection integration (mode `warn`, active
 * whenever SENTRY_DSN is set) logs and keeps the process running. So the failure
 * is handled here: log it, capture it for GlitchTip (catching it means the SDK's
handler no longer sees it), flush within a bound, exit non-zero —
 * the container restart policy then retries the boot.
 */
export async function runBootstrap(
  boot: () => Promise<void>,
  deps: RunBootstrapDeps,
): Promise<void> {
  try {
    await boot();
  } catch (error) {
    deps.log("api boot failed; exiting so the restart policy retries", error);
    deps.capture(error);
    const timeoutMs = deps.flushTimeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS;
    let timer: NodeJS.Timeout | undefined;
    const bound = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    try {
      await Promise.race([deps.flush(timeoutMs).catch(() => undefined), bound]);
    } finally {
      clearTimeout(timer);
    }
    deps.exit(1);
  }
}
