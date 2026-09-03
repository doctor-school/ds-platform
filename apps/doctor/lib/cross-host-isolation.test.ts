import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 020 EARS-1 / EARS-18 (#1764, slice 3) — the STRUCTURAL half of cross-host
 * identity, pinned where it runs on every push rather than only on a stand.
 *
 * `020-scenarios.feature` L102–109: the two storefronts render the same event
 * from ONE core. The behavioural half (content-identical public bodies) is the
 * live tier `apps/doctor/e2e/event-page.spec.ts` + the api e2e; the half a unit
 * can hold is the one that actually rots first — an `apps/doctor` file quietly
 * importing from `apps/portal` (or the reverse) to "reuse" a mapper, which is how
 * a second composition gets born. There is no package alias for either app, so a
 * cross-app import can only be spelled with the other app's path.
 *
 * `e2e/` is excluded on both sides: those files legitimately NAME the other host
 * in prose (the portal's return-context tier cites doctor.school, and the doctor
 * event-page tier cites the academy's endpoint).
 */

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

function sourceFiles(app: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
  };
  walk(join(root, "apps", app));
  return out;
}

describe("020 EARS-1 cross-host isolation", () => {
  it.each([
    ["doctor", "apps/portal"],
    ["portal", "apps/doctor"],
  ])(
    "020 EARS-1: apps/%s shall import nothing from %s — the shared unit is the only thing the storefronts have in common",
    (app, forbidden) => {
      const offending: string[] = [];
      for (const file of sourceFiles(app)) {
        if (file.includes(join("apps", app, "e2e"))) continue;
        for (const line of readFileSync(file, "utf8").split("\n")) {
          if (!/^\s*(import|export)\b/.test(line)) continue;
          if (line.includes(forbidden)) offending.push(`${file}: ${line.trim()}`);
        }
      }
      expect(offending).toEqual([]);
    },
  );
});
