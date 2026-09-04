// @vitest-environment node
// A filesystem walk needs no DOM, and under the package's default jsdom environment
// `import.meta.url` is not a `file:` URL, so the source root cannot be derived from
// it. Node it is — this suite reads files, it does not render anything.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 006 — the structural guard that keeps `@ds/room` hostable by BOTH storefronts.
 *
 * The whole reason ONE package can serve the Academy and the doctor storefront is
 * that it depends on neither. `apps/doctor` has no `next-intl` and no messages
 * catalogue, so a single `useTranslations` inside the package would make the room
 * un-mountable there; a `next/navigation` or `next/link` import would bind it to
 * the App Router; an `apps/portal` / `apps/doctor` import would invert the
 * dependency direction the two hosts exist to keep apart (the app-side twin of
 * this guard is `apps/doctor/lib/cross-host-isolation.test.ts`).
 *
 * A `process.env` read is banned for the same reason with a different mechanism:
 * the package must take its configuration from injected props, not from whichever
 * host process happens to load it — a server-only env read inside a shared unit is
 * invisible on one host until it renders wrong on the other.
 *
 * The rewrite-parity assertion is deliberately NOT exempted here: it imports each
 * host's own `next.config.ts` and therefore lives at app level
 * (`apps/portal/lib/next-config-rewrite.test.ts` + the doctor twin), never in this
 * tree.
 */

const srcRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));

/** Module specifiers no file under `packages/room/src` may import. */
const BANNED_SPECIFIERS = [
  { pattern: /["']next-intl["']|["']next-intl\//, label: "next-intl" },
  { pattern: /["']next["']/, label: "next" },
  { pattern: /["']next\//, label: "next/*" },
  { pattern: /apps\/portal/, label: "apps/portal" },
  { pattern: /apps\/doctor/, label: "apps/doctor" },
];

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "dist") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
  };
  walk(srcRoot);
  return out;
}

const isTestFile = (file: string) => /\.test\.tsx?$/.test(file);

describe("006 packages/room purity", () => {
  it("006: the shared room unit imports no host and no framework catalogue", () => {
    const offences: string[] = [];
    for (const file of sourceFiles()) {
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, index) => {
        if (!/^\s*(import|export)\b/.test(line)) return;
        for (const { pattern, label } of BANNED_SPECIFIERS) {
          if (pattern.test(line)) {
            offences.push(`${relative(srcRoot, file)}:${index + 1} imports ${label}`);
          }
        }
      });
    }
    expect(offences).toEqual([]);
  });

  it("006: the shared room unit reads no process.env — configuration is injected", () => {
    const offences: string[] = [];
    for (const file of sourceFiles()) {
      if (isTestFile(file)) continue;
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, index) => {
        if (/process\.env/.test(line)) {
          offences.push(`${relative(srcRoot, file)}:${index + 1} reads process.env`);
        }
      });
    }
    expect(offences).toEqual([]);
  });
});
