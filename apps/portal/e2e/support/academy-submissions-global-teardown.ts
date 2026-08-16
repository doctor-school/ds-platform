import { realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";

const SAFE_MARKER = "ACADEMY_PARTNERSHIP_E2E_SAFE";
const SAFE_PREFIX = "academy-partnership-e2e-";

function normalized(path: string): string {
  const resolved = resolve(path);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function assertSafeTemporaryPath(path: string): Promise<string> {
  const resolvedPath = resolve(path);
  const [realTarget, realTemporaryRoot] = await Promise.all([
    realpath(resolvedPath),
    realpath(tmpdir()),
  ]);
  if (
    normalized(realTarget) !== normalized(resolvedPath) ||
    normalized(dirname(realTarget)) !== normalized(realTemporaryRoot) ||
    !basename(realTarget).startsWith(SAFE_PREFIX)
  ) {
    throw new Error("Refusing to remove an unsafe Academy E2E path");
  }
  return realTarget;
}

export default async function academySubmissionsGlobalTeardown() {
  if (process.env[SAFE_MARKER] !== "1") return;
  const directory = process.env.ACADEMY_SUBMISSIONS_DIR;
  if (!directory) return;

  for (const candidate of [directory, `${directory}.backup`]) {
    try {
      const safePath = await assertSafeTemporaryPath(candidate);
      await rm(safePath, { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
