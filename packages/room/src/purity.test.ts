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

/**
 * Every `import` / `export` STATEMENT in `text`, with the 1-based line the
 * statement starts on.
 *
 * A line-by-line scan is not enough: a multi-line import
 * (`import {` … `} from "next-intl";`) puts the banned specifier on a line that
 * does not itself start with `import`, so the statement escapes the filter while
 * the ban is plainly violated. Matching whole statements — from the `import` /
 * `export` keyword through the closing quote of its specifier — makes the scan
 * specifier-aware regardless of how the statement is wrapped.
 */
export function importStatements(
  text: string,
): { statement: string; line: number }[] {
  const out: { statement: string; line: number }[] = [];
  // Either a `… from "spec"` form (any amount of whitespace/braces/newlines in
  // between) or a bare side-effect `import "spec"`.
  const re =
    /(?:^|\n)[ \t]*(?:import|export)\b(?:[^;]*?\bfrom[ \t\r\n]*)?["'][^"']+["']/g;
  for (const match of text.matchAll(re)) {
    const index = match.index ?? 0;
    out.push({
      statement: match[0],
      // The match may start at the newline preceding the keyword — count the
      // lines up to the keyword itself so the reported line is the statement's.
      line: text.slice(0, index + (match[0].startsWith("\n") ? 1 : 0)).split(/\n/)
        .length,
    });
  }
  return out;
}

describe("006 packages/room purity", () => {
  it("006: the shared room unit imports no host and no framework catalogue", () => {
    const offences: string[] = [];
    for (const file of sourceFiles()) {
      for (const { statement, line } of importStatements(
        readFileSync(file, "utf8"),
      )) {
        for (const { pattern, label } of BANNED_SPECIFIERS) {
          if (pattern.test(statement)) {
            offences.push(`${relative(srcRoot, file)}:${line} imports ${label}`);
          }
        }
      }
    }
    expect(offences).toEqual([]);
  });

  it("006: the purity scan catches a banned specifier split across lines", () => {
    // The regression the line-by-line scan missed: only the LAST line of this
    // statement names `next-intl`, and it starts with `}` — not with `import`.
    const multiline = [
      'import {',
      '  useTranslations,',
      '  useLocale,',
      '} from "next-intl";',
      "",
    ].join("\n");
    const hits = importStatements(multiline).filter((s) =>
      BANNED_SPECIFIERS.some(({ pattern }) => pattern.test(s.statement)),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(1);

    // …and a single-line import is still caught, on its own line.
    const singleLine = 'import Link from "next/link";\n';
    const single = importStatements(singleLine).filter((s) =>
      BANNED_SPECIFIERS.some(({ pattern }) => pattern.test(s.statement)),
    );
    expect(single).toHaveLength(1);
    expect(single[0].line).toBe(1);

    // A plain string mentioning a banned name is not an import — no false positive.
    expect(
      importStatements('const doc = "see next-intl for the host";\n'),
    ).toEqual([]);
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
