// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

/**
 * #2981 — the staging-contour route manifest is served at RUNTIME, gated by the
 * `CONTOUR_MANIFEST` env: every image carries the manifest (one image serves
 * stage and prod), only a slot container sets the flag, so production answers
 * 404 at `MANIFEST_PATH` (`packages/e2e/hosts.ts`).
 */
const MANIFEST = { "/page": "app/page.js", "/login/page": "app/login/page.js" };

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "contour-"));
  mkdirSync(path.join(root, ".next", "server"), { recursive: true });
  writeFileSync(
    path.join(root, ".next", "server", "app-paths-manifest.json"),
    JSON.stringify(MANIFEST),
  );
  vi.spyOn(process, "cwd").mockReturnValue(root);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe("2981: /__contour/app-paths-manifest.json is gated by runtime env", () => {
  it("2981: CONTOUR_MANIFEST=1 answers 200 with the build's route manifest", async () => {
    vi.stubEnv("CONTOUR_MANIFEST", "1");

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual(MANIFEST);
  });

  it("2981: without CONTOUR_MANIFEST=1 the path answers 404 and reads nothing", async () => {
    vi.stubEnv("CONTOUR_MANIFEST", undefined);
    expect((await GET()).status).toBe(404);

    vi.stubEnv("CONTOUR_MANIFEST", "0");
    expect((await GET()).status).toBe(404);
  });
});
