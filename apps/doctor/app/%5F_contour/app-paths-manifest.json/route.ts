import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * STAGING-CONTOUR ROUTE MANIFEST, OFF BY DEFAULT (#2981; staging/regression-
 * contour tech spec §6.3). Serves `.next/server/app-paths-manifest.json` — the
 * route list THIS image mounts, read by the derived route walk — at
 * `MANIFEST_PATH` in `packages/e2e/hosts.ts` (the `%5F` folder prefix is how
 * the App Router spells a URL segment that starts with `_`).
 *
 * Every image carries the manifest at that non-public path (the standalone
 * bundle, `apps/doctor/Dockerfile`), because one image serves stage and prod; the
 * gate is RUNTIME env. Only the slot compose sets `CONTOUR_MANIFEST=1`, so
 * production answers 404 here.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  if (process.env.CONTOUR_MANIFEST !== "1") {
    return new Response(null, { status: 404 });
  }
  const manifest = await readFile(
    path.join(process.cwd(), ".next", "server", "app-paths-manifest.json"),
    "utf8",
  );
  return new Response(manifest, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
