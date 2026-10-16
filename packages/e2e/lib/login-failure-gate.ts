import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * The login-failure gate (#2956): keeps the suite's own password sign-in
 * attempts from tripping the per-IP login challenge for parallel workers.
 *
 * 003 EARS-17: after 3 failed `POST /v1/auth/login` from one IP within 15
 * minutes the api requires a captcha on that IP's next login, and only a
 * successful password login clears the count (`apps/api/src/auth/
 * login-challenge/`, kept in the api process's memory). Every worker of a stage
 * run leaves from the operator's one IP, so three deliberate wrong-password
 * probes landing close together made every parallel password sign-in answer
 * 403 and the login door show SmartCaptcha (#2956). The product rule stays.
 *
 * The suite's invariant instead: at most ONE failed password login is ever
 * outstanding. Every step that submits the password form runs through
 * `gatedPasswordLogin` (`./gated-password-login.ts`), which
 *   1. takes a cross-worker gate — a directory lock in the OS temp dir, so
 *      Playwright's worker PROCESSES (and a second run from the same machine)
 *      take turns;
 *   2. runs the step's own submit and response capture, unchanged;
 *   3. closes with a real successful password sign-in of the worker's golden
 *      doctor from a cookie-free request context — the probe's browser context
 *      never sees it — which clears the origin's failure window;
 *   4. releases the gate.
 * The other password sign-ins (`signInGoldenDoctor`) can only succeed, so they
 * need no gate: while every failure is closed before the next one starts the
 * count never reaches the threshold, and nobody sees the challenge.
 *
 * A gate whose owning process is gone (a worker killed mid-step) is taken over.
 */

const DEFAULT_LOCK = path.join(os.tmpdir(), "ds-e2e-login-failure-gate.lock");
const OWNER_FILE = "owner";

export interface GateOptions {
  /** The lock directory; one per machine by default. */
  lockPath?: string;
  /** The successful sign-in that clears the origin's failure window. */
  close: () => Promise<void>;
  /** How long to wait between attempts to take the gate. */
  pollMs?: number;
  /** Whether the process that holds the gate still runs. */
  isAlive?: (pid: number) => boolean;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function acquire(
  lockPath: string,
  pollMs: number,
  isAlive: (pid: number) => boolean,
): Promise<void> {
  for (;;) {
    try {
      await mkdir(lockPath);
      await writeFile(path.join(lockPath, OWNER_FILE), String(process.pid));
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const owner = Number(
      await readFile(path.join(lockPath, OWNER_FILE), "utf8").catch(() => ""),
    );
    // No owner file yet = the holder is between mkdir and writeFile: wait.
    if (Number.isInteger(owner) && owner > 0 && !isAlive(owner)) {
      await rm(lockPath, { recursive: true, force: true });
      continue;
    }
    await sleep(pollMs);
  }
}

/**
 * Runs one password-login `attempt` under the gate and closes it with
 * `options.close`, even when the attempt throws. Steps call it through
 * `gatedPasswordLogin` (`./gated-password-login.ts`).
 */
export async function runGatedLoginAttempt<T>(
  options: GateOptions,
  attempt: () => Promise<T>,
): Promise<T> {
  const lockPath = options.lockPath ?? DEFAULT_LOCK;
  await acquire(
    lockPath,
    options.pollMs ?? 100,
    options.isAlive ?? processIsAlive,
  );
  try {
    try {
      return await attempt();
    } finally {
      await options.close();
    }
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}
