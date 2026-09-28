import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DESIGN_SYNC_PROJECT,
  checkProvenance,
  vendorCanvases,
} from "../../design/vendor-canvas.mjs";
import { runGuard } from "./run-guard";

/**
 * #2389 D3–D5: every vendored `design-source/**\/*.dc.html` carries a manifest
 * entry whose sha256 equals the file bytes; `pnpm design:vendor` is the one
 * writer; `canvas-provenance` (BLOCK) is its `--check`.
 */
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const sha = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

function tree(files: Record<string, string>, manifest?: unknown): string {
  const root = mkdtempSync(join(tmpdir(), "canvas-provenance-"));
  dirs.push(root);
  for (const [path, bytes] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), bytes, "utf8");
  }
  if (manifest !== undefined)
    writeFileSync(
      join(root, "design-source/manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf8",
    );
  return root;
}

const canvas = "<x-dc>auth</x-dc>\n";
const archived = "<x-dc>archive</x-dc>\n";
const entry = (bytes: string) => ({
  sha256: sha(bytes),
  pulledAt: "2026-09-15",
  remotePath: null,
});
const goodManifest = {
  version: 1,
  designSyncProject: DESIGN_SYNC_PROJECT,
  files: {
    "auth.dc.html": entry(canvas),
    "archive/archive-auth-v1.dc.html": entry(archived),
  },
};
const goodFiles = {
  "design-source/auth.dc.html": canvas,
  "design-source/archive/archive-auth-v1.dc.html": archived,
  "design-source/README.md": "# not a canvas\n",
};

describe("canvas provenance check (#2389)", () => {
  it("green: every canvas (archive included) matches its manifest entry", () => {
    expect(checkProvenance(tree(goodFiles, goodManifest))).toEqual({
      ok: true,
      problems: [],
    });
  });

  it("red: a canvas edited after vendoring (the #2338 shape) mismatches its recorded sha256", () => {
    const root = tree(
      {
        ...goodFiles,
        "design-source/auth.dc.html": `${canvas}<p>Эфиры, программы и сертификация</p>\n`,
      },
      goodManifest,
    );
    const verdict = checkProvenance(root);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join("\n")).toContain(
      "design-source/auth.dc.html: sha256 mismatch",
    );
  });

  it("red: a canvas with no manifest entry fails", () => {
    const root = tree(
      { ...goodFiles, "design-source/new.dc.html": "<x-dc>new</x-dc>" },
      goodManifest,
    );
    expect(checkProvenance(root).problems.join("\n")).toContain(
      "design-source/new.dc.html: no manifest entry",
    );
  });

  it("red: an entry for a canvas that is not on disk fails", () => {
    const { "design-source/auth.dc.html": _gone, ...rest } = goodFiles;
    expect(
      checkProvenance(tree(rest, goodManifest)).problems.join("\n"),
    ).toContain(
      "design-source/auth.dc.html: manifest entry without a vendored file",
    );
  });

  it("red: a missing manifest fails closed", () => {
    expect(checkProvenance(tree(goodFiles)).problems.join("\n")).toContain(
      "design-source/manifest.json missing",
    );
  });

  it("red: a malformed entry (no pulledAt date, wrong project) fails", () => {
    const root = tree(goodFiles, {
      ...goodManifest,
      designSyncProject: "someone-else",
      files: {
        ...goodManifest.files,
        "auth.dc.html": { sha256: sha(canvas), pulledAt: "soon" },
      },
    });
    const problems = checkProvenance(root).problems.join("\n");
    expect(problems).toContain("designSyncProject");
    expect(problems).toContain("design-source/auth.dc.html: pulledAt");
  });
});

describe("pnpm design:vendor writer (#2389)", () => {
  const now = new Date("2026-09-28T10:00:00.000Z");

  it("NEW → SAME → CHANGED, byte-exact copy, manifest upserted with pulledAt = now UTC", () => {
    const root = tree(goodFiles, goodManifest);
    const pulled = join(root, "pulled");
    mkdirSync(pulled);
    const fresh = "<x-dc>fresh — кириллица\r\n</x-dc>";
    writeFileSync(join(pulled, "fresh.dc.html"), fresh, "utf8");

    expect(
      vendorCanvases(root, [join(pulled, "fresh.dc.html")], {
        remote: "fresh.dc.html",
        now,
      }),
    ).toEqual([`NEW design-source/fresh.dc.html ${Buffer.byteLength(fresh)}`]);
    const copied = readFileSync(join(root, "design-source/fresh.dc.html"));
    expect(copied.equals(Buffer.from(fresh, "utf8"))).toBe(true);
    const manifest = JSON.parse(
      readFileSync(join(root, "design-source/manifest.json"), "utf8"),
    );
    expect(manifest.files["fresh.dc.html"]).toEqual({
      sha256: sha(fresh),
      pulledAt: "2026-09-28T10:00:00.000Z",
      remotePath: "fresh.dc.html",
    });
    expect(checkProvenance(root).ok).toBe(true);

    expect(
      vendorCanvases(root, [join(pulled, "fresh.dc.html")], { now })[0],
    ).toMatch(/^SAME design-source\/fresh\.dc\.html /);
    writeFileSync(join(pulled, "fresh.dc.html"), `${fresh}!`, "utf8");
    expect(
      vendorCanvases(root, [join(pulled, "fresh.dc.html")], { now })[0],
    ).toMatch(/^CHANGED design-source\/fresh\.dc\.html /);
    expect(checkProvenance(root).ok).toBe(true);
  });

  it("a real pull replaces the backfill note", () => {
    const root = tree(goodFiles, {
      ...goodManifest,
      files: {
        ...goodManifest.files,
        "auth.dc.html": { ...entry(canvas), note: "backfill" },
      },
    });
    const pulled = join(root, "auth.dc.html");
    writeFileSync(pulled, canvas, "utf8");
    vendorCanvases(root, [pulled], { now });
    const manifest = JSON.parse(
      readFileSync(join(root, "design-source/manifest.json"), "utf8"),
    );
    expect(manifest.files["auth.dc.html"].note).toBeUndefined();
    expect(manifest.files["auth.dc.html"].pulledAt).toBe(now.toISOString());
  });

  it("refuses a non-canvas file", () => {
    const root = tree(goodFiles, goodManifest);
    const pulled = join(root, "notes.txt");
    writeFileSync(pulled, "x", "utf8");
    expect(() => vendorCanvases(root, [pulled], { now })).toThrow(/\.dc\.html/);
    expect(existsSync(join(root, "design-source/notes.txt"))).toBe(false);
  });
});

describe("canvas-provenance guard (BLOCK)", () => {
  it("green: exits 0 on a matching tree", () => {
    const { code, stdout } = runGuard(
      "canvas-provenance-lint.ts",
      tree(goodFiles, goodManifest),
    );
    expect(code).toBe(0);
    expect(stdout).toContain("2 vendored canvases match");
  });

  it("red: exits 1 on a canvas edited without a vendoring pass", () => {
    const { code, stderr } = runGuard(
      "canvas-provenance-lint.ts",
      tree(
        { ...goodFiles, "design-source/auth.dc.html": `${canvas}edited` },
        goodManifest,
      ),
    );
    expect(code).toBe(1);
    expect(stderr).toContain("design-source/auth.dc.html: sha256 mismatch");
  });
});
