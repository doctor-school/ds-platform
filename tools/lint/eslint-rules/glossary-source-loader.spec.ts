import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readGlossarySourceSync } from "../lib/glossary-source.mjs";

/**
 * Unit proof for the SHARED primitive both glossary readers delegate to (#500).
 *
 * The id-set reader's spec (`glossary-ids-loader.spec.ts`) covers the id
 * projection + floor assertion; this spec covers the primitive's own richer
 * contract — the `{ id, file }` term records, the POSIX `file` path, and the
 * `skipped` list for marker-less files — and the DELIBERATE ABSENCE of a floor
 * throw at this layer (an empty result is valid for the primitive; only the
 * id-set wrapper asserts non-emptiness).
 */
describe("readGlossarySourceSync", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "gloss-src-"));
    mkdirSync(join(root, "apps/docs/content/product/glossary"), {
      recursive: true,
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns { id, file } term records with repo-relative POSIX paths", () => {
    const dir = join(root, "apps/docs/content/product/glossary");
    writeFileSync(join(dir, "a.md"), "title: A\n\n**Canonical id:** `consent_gate`\n");
    writeFileSync(join(dir, "b.md"), "title: B\n\n**Canonical id:** `user_mirror`\n");

    const { terms } = readGlossarySourceSync(root);
    expect(terms).toEqual([
      { id: "consent_gate", file: "apps/docs/content/product/glossary/a.md" },
      { id: "user_mirror", file: "apps/docs/content/product/glossary/b.md" },
    ]);
  });

  it("reports marker-less files in `skipped`, not `terms`", () => {
    const dir = join(root, "apps/docs/content/product/glossary");
    writeFileSync(join(dir, "a.md"), "title: A\n\n**Canonical id:** `consent_gate`\n");
    writeFileSync(join(dir, "no-marker.md"), "title: X\n\njust prose, no marker.\n");

    const { terms, skipped } = readGlossarySourceSync(root);
    expect(terms.map((t) => t.id)).toEqual(["consent_gate"]);
    expect(skipped).toEqual(["apps/docs/content/product/glossary/no-marker.md"]);
  });

  it("does NOT throw on an empty/marker-less source (floor lives in the id-set reader)", () => {
    const dir = join(root, "apps/docs/content/product/glossary");
    writeFileSync(join(dir, "broken.md"), "title: Broken\n\nno marker here.\n");

    expect(() => readGlossarySourceSync(root)).not.toThrow();
    const { terms, skipped } = readGlossarySourceSync(root);
    expect(terms).toEqual([]);
    expect(skipped).toHaveLength(1);
  });
});
