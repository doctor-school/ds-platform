import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BASELINE_REL,
  STATES_BEGIN,
  STATES_END,
  TOKENS_REL,
  checkStates,
  generateStatesBlock,
  measureCanvas,
  stampCanvas,
} from "../../design/canvas-states.mjs";
import {
  DESIGN_SYNC_PROJECT,
  checkProvenance,
  restampCanvases,
  vendorCanvases,
} from "../../design/vendor-canvas.mjs";
import { REPO_ROOT, runGuard } from "./run-guard";

/**
 * #2221: `pnpm design:vendor` re-stamps the tokens.css-generated control-state
 * block between `/* ds-states:begin *\/ … /* ds-states:end *\/` in every
 * non-archive canvas, and its `--check` (the `canvas-provenance` BLOCK guard)
 * refuses (1) an untagged `<a>`/`<button>`, (2) an off-token native
 * `style-hover`/`style-focus`, (3) a drifted or missing block — checks 1+2 over
 * a shrink-only legacy baseline, check 3 for every canvas.
 */
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const sha = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const TOKENS = readFileSync(join(REPO_ROOT, TOKENS_REL), "utf8");
const BLOCK = generateStatesBlock(TOKENS);

const helmet = (css: string) =>
  `<x-dc>\n<helmet><style>body{margin:0}${css}</style></helmet>\n`;
const clean = `${helmet(BLOCK)}<button data-btn="primary">Go</button>\n<a href="#" data-link>More</a>\n<button style="{{ t.style }}" onclick="toggleTheme()">Theme</button>\n</x-dc>\n`;

function tree(
  canvases: Record<string, string>,
  baseline?: Record<string, { untagged: number; offToken: number }>,
): string {
  const root = mkdtempSync(join(tmpdir(), "canvas-states-"));
  dirs.push(root);
  mkdirSync(join(root, "packages/design-system/src/styles"), {
    recursive: true,
  });
  writeFileSync(join(root, TOKENS_REL), TOKENS, "utf8");
  const files: Record<string, unknown> = {};
  for (const [name, bytes] of Object.entries(canvases)) {
    mkdirSync(join(root, "design-source", name, ".."), { recursive: true });
    writeFileSync(join(root, "design-source", name), bytes, "utf8");
    files[name] = {
      sha256: sha(bytes),
      pulledAt: "2026-09-15",
      remotePath: null,
    };
  }
  writeFileSync(
    join(root, "design-source/manifest.json"),
    JSON.stringify({
      version: 1,
      designSyncProject: DESIGN_SYNC_PROJECT,
      files,
    }),
    "utf8",
  );
  if (baseline)
    writeFileSync(
      join(root, BASELINE_REL),
      JSON.stringify({ version: 1, canvases: baseline }),
      "utf8",
    );
  return root;
}
const problems = (root: string) => checkStates(root).problems.join("\n");

describe("state block generator (#2221)", () => {
  it("is generated from tokens.css values, canvas theme vars first", () => {
    expect(BLOCK.startsWith(STATES_BEGIN)).toBe(true);
    expect(BLOCK.endsWith(STATES_END)).toBe(true);
    expect(BLOCK).toContain(
      '[data-btn="primary"]:hover{background:var(--btn-hover,#0d3a77)!important',
    );
    expect(BLOCK).toContain(
      "[data-ghost]:focus-visible{box-shadow:inset 0 0 0 3px rgba(107, 177, 247, 0.5)!important}",
    );
    const edited = TOKENS.replace(
      "--color-primary-hover: #0d3a77;",
      "--color-primary-hover: #000001;",
    );
    expect(generateStatesBlock(edited)).toContain("var(--btn-hover,#000001)");
  });

  it("owns only tagged selectors — no untagged-button fallbacks", () => {
    expect(BLOCK).not.toContain("button[style*=");
  });
});

describe("stamp (#2221)", () => {
  it("appends the block to the helmet <style>, replacing legacy owned rules; idempotent", () => {
    const legacy = `${helmet('a{color:red}[data-btn="primary"]:hover{background:red}[data-link]:hover,button[style*="x"]:hover{opacity:1}')}<p/>\n</x-dc>\n`;
    const once = stampCanvas(legacy, BLOCK);
    expect(once).toBe(
      `${helmet(`a{color:red}button[style*="x"]:hover{opacity:1}${BLOCK}`)}<p/>\n</x-dc>\n`,
    );
    expect(stampCanvas(once, BLOCK)).toBe(once);
  });

  it("strips only the owned selectors from a mixed selector list", () => {
    const mixed = `${helmet(".keep:hover,[data-link]:hover,.also{color:red}[data-ghost]:hover{x:1}")}<p/>\n</x-dc>\n`;
    expect(stampCanvas(mixed, BLOCK)).toBe(
      `${helmet(`.keep:hover,.also{color:red}${BLOCK}`)}<p/>\n</x-dc>\n`,
    );
  });

  it("replaces a hand-edited block between the markers", () => {
    const edited = clean.replace("#0d3a77", "#123456");
    expect(stampCanvas(edited, BLOCK)).toBe(clean);
  });

  it("helmet without <style> gets one; no helmet gets one after <x-dc>", () => {
    expect(
      stampCanvas("<x-dc>\n<helmet>\n<link>\n</helmet>\n<div/></x-dc>", BLOCK),
    ).toBe(
      `<x-dc>\n<helmet>\n<link>\n<style>${BLOCK}</style></helmet>\n<div/></x-dc>`,
    );
    expect(stampCanvas("<x-dc>\n<a data-link>x</a></x-dc>", BLOCK)).toBe(
      `<x-dc>\n<helmet><style>${BLOCK}</style></helmet>\n<a data-link>x</a></x-dc>`,
    );
  });
});

describe("states check (#2221)", () => {
  it("green: a stamped, tagged, on-token canvas; archive is out of scope", () => {
    const root = tree({
      "auth.dc.html": clean,
      "archive/old.dc.html": "<x-dc><button>x</button></x-dc>",
    });
    expect(checkStates(root)).toEqual({ ok: true, problems: [] });
  });

  it("red (check 1): an untagged <button> on a canvas not on the baseline, with file:line", () => {
    const root = tree({
      "auth.dc.html": clean.replace("</x-dc>", "<button>Buy</button>\n</x-dc>"),
    });
    expect(problems(root)).toContain(
      "design-source/auth.dc.html:6: untagged control <button>",
    );
  });

  it("red (check 1): an untagged <a> fails too", () => {
    const root = tree({ "auth.dc.html": clean.replace(" data-link>", ">") });
    expect(problems(root)).toContain(
      "design-source/auth.dc.html:4: untagged control <a>",
    );
  });

  it("red (check 2): an off-token style-hover literal, with file:line and value", () => {
    const root = tree({
      "auth.dc.html": clean.replace(
        "data-link>",
        'data-link style-hover="background:#123456">',
      ),
    });
    expect(problems(root)).toContain(
      "design-source/auth.dc.html:4: off-token style-hover value `background:#123456`",
    );
  });

  it("green (check 2): token var and literal tokens.css values pass", () => {
    const root = tree({
      "auth.dc.html": clean.replace(
        "data-link>",
        'data-link style-hover="background:var(--color-tint) !important;color:#114D9E" style-focus="box-shadow:0 0 0 3px rgba(107,177,247,.5)">',
      ),
    });
    expect(checkStates(root).ok).toBe(true);
  });

  it("red (check 3): a hand-edited block", () => {
    const root = tree({ "auth.dc.html": clean.replace("#0d3a77", "#123456") });
    expect(problems(root)).toContain(
      "design-source/auth.dc.html: ds-states block differs from the tokens.css-generated text",
    );
  });

  it("red (check 3): missing markers, even on a baseline canvas", () => {
    const root = tree(
      {
        "auth.dc.html":
          "<x-dc><helmet><style>[data-btn]{transition:all .15s}</style></helmet></x-dc>",
      },
      {
        "auth.dc.html": { untagged: 0, offToken: 0 },
      },
    );
    expect(problems(root)).toContain(
      "design-source/auth.dc.html: no ds-states markers",
    );
  });

  it("baseline: exact counts pass; growth fails; a stale (shrunk or clean) entry fails", () => {
    const legacy = clean.replace(
      "</x-dc>",
      '<button style-hover="color:red">Buy</button>\n</x-dc>',
    );
    expect(
      checkStates(
        tree(
          { "auth.dc.html": legacy },
          { "auth.dc.html": { untagged: 1, offToken: 1 } },
        ),
      ).ok,
    ).toBe(true);
    expect(
      problems(
        tree(
          { "auth.dc.html": legacy },
          { "auth.dc.html": { untagged: 0, offToken: 1 } },
        ),
      ),
    ).toContain("design-source/auth.dc.html:6: untagged control <button>");
    expect(
      problems(
        tree(
          { "auth.dc.html": legacy },
          { "auth.dc.html": { untagged: 2, offToken: 1 } },
        ),
      ),
    ).toContain("stale baseline entry");
    expect(
      problems(
        tree(
          { "auth.dc.html": clean },
          { "auth.dc.html": { untagged: 0, offToken: 0 } },
        ),
      ),
    ).toContain("design-source/auth.dc.html: stale baseline entry");
    expect(
      problems(
        tree(
          { "auth.dc.html": clean },
          { "gone.dc.html": { untagged: 1, offToken: 0 } },
        ),
      ),
    ).toContain("design-source/gone.dc.html: stale baseline entry");
  });

  it("measures untagged controls and off-token values, skipping toolbar controls", () => {
    expect(measureCanvas(clean)).toEqual({ untagged: [], offToken: [] });
  });
});

describe("pnpm design:vendor stamps at vendoring (#2221)", () => {
  const now = new Date("2026-10-22T10:00:00.000Z");

  it("records stamped sha256 + pulled sha256; shrinks the baseline when a canvas comes back clean", () => {
    const root = tree(
      { "auth.dc.html": clean },
      {
        "auth.dc.html": { untagged: 1, offToken: 0 },
        "other.dc.html": { untagged: 3, offToken: 0 },
      },
    );
    const pull = clean.replace(BLOCK, "");
    const pulled = join(root, "auth.dc.html");
    writeFileSync(pulled, pull, "utf8");
    expect(vendorCanvases(root, [pulled], { now })).toEqual([
      `SAME design-source/auth.dc.html ${Buffer.byteLength(clean)}`,
    ]);
    const manifest = JSON.parse(
      readFileSync(join(root, "design-source/manifest.json"), "utf8"),
    );
    expect(manifest.files["auth.dc.html"]).toMatchObject({
      sha256: sha(clean),
      pulledSha256: sha(pull),
    });
    const baseline = JSON.parse(readFileSync(join(root, BASELINE_REL), "utf8"));
    expect(baseline.canvases).toEqual({
      "other.dc.html": { untagged: 3, offToken: 0 },
    });
  });

  it("--restamp re-stamps in place, keeps pulledAt, records the pre-stamp sha as pulledSha256, second run SAME", () => {
    const raw =
      '<x-dc>\n<helmet><style>body{margin:0}</style></helmet>\n<button data-btn="primary">Go</button>\n</x-dc>\n';
    const root = tree({ "a.dc.html": raw, "archive/old.dc.html": raw });
    expect(restampCanvases(root)[0]).toMatch(
      /^CHANGED design-source\/a\.dc\.html /,
    );
    const manifest = JSON.parse(
      readFileSync(join(root, "design-source/manifest.json"), "utf8"),
    );
    expect(manifest.files["a.dc.html"]).toMatchObject({
      pulledAt: "2026-09-15",
      pulledSha256: sha(raw),
    });
    expect(
      readFileSync(join(root, "design-source/archive/old.dc.html"), "utf8"),
    ).toBe(raw);
    expect(restampCanvases(root)).toEqual([
      expect.stringMatching(/^SAME design-source\/a\.dc\.html /),
    ]);
    expect(checkProvenance(root).ok).toBe(true);
    expect(checkStates(root).ok).toBe(true);
  });

  it("--restamp refuses a canvas whose bytes differ from the manifest sha256, writing nothing", () => {
    const raw =
      "<x-dc>\n<helmet><style>body{margin:0}</style></helmet>\n<p>a</p>\n</x-dc>\n";
    const root = tree({ "a.dc.html": raw, "b.dc.html": raw });
    const edited = raw.replace("<p>a</p>", "<p>hand edit</p>");
    writeFileSync(join(root, "design-source/a.dc.html"), edited, "utf8");
    const manifestPath = join(root, "design-source/manifest.json");
    const manifestBefore = readFileSync(manifestPath, "utf8");
    expect(() => restampCanvases(root)).toThrow(
      /design-source\/a\.dc\.html.*re-vendor it from Claude Design/,
    );
    const read = (rel: string) => readFileSync(join(root, rel), "utf8");
    expect(read("design-source/a.dc.html")).toBe(edited);
    expect(read("design-source/b.dc.html")).toBe(raw);
    expect(read("design-source/manifest.json")).toBe(manifestBefore);
  });
});

describe("canvas-provenance guard runs the states check (BLOCK)", () => {
  it("green on a stamped tree, red with file:line on an untagged control", () => {
    expect(
      runGuard("canvas-provenance-lint.ts", tree({ "auth.dc.html": clean }))
        .code,
    ).toBe(0);
    const { code, stderr } = runGuard(
      "canvas-provenance-lint.ts",
      tree({
        "auth.dc.html": clean.replace(
          "</x-dc>",
          "<button>Buy</button>\n</x-dc>",
        ),
      }),
    );
    expect(code).toBe(1);
    expect(stderr).toContain(
      "design-source/auth.dc.html:6: untagged control <button>",
    );
  });
});
