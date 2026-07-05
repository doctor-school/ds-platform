import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readGlossaryIdsSync } from "../lib/glossary-ids.mjs";

/**
 * Unit proof for the id-set loader behind `glossary-canonical-ids` (#468).
 *
 * The load-bearing property is the FLOOR ASSERTION: the glossary source is
 * committed, so a zero-id parse means the source moved / emptied / lost its
 * `**Canonical id:**` markers — which would make the rule silently enforce
 * nothing. The loader must throw loud rather than return an empty set.
 */
describe("readGlossaryIdsSync", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "gloss-ids-"));
    mkdirSync(join(root, "apps/docs/content/product/glossary"), {
      recursive: true,
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("parses canonical ids from `**Canonical id:**` markers", () => {
    const dir = join(root, "apps/docs/content/product/glossary");
    writeFileSync(join(dir, "a.md"), "title: A\n\n**Canonical id:** `consent_gate`\n");
    writeFileSync(join(dir, "b.md"), "title: B\n\n**Canonical id:** `user_mirror`\n");
    // A file with no marker contributes nothing (not an error on its own).
    writeFileSync(join(dir, "c.md"), "title: C\n\njust prose, no marker.\n");

    const ids = readGlossaryIdsSync(root);
    expect([...ids].sort()).toEqual(["consent_gate", "user_mirror"]);
  });

  it("throws (does not silently no-op) when zero ids are parsed", () => {
    // Glossary dir exists but every file lacks a canonical-id marker.
    const dir = join(root, "apps/docs/content/product/glossary");
    writeFileSync(join(dir, "broken.md"), "title: Broken\n\nno marker here.\n");

    expect(() => readGlossaryIdsSync(root)).toThrow(/no glossary canonical ids parsed/);
  });

  it("throws when the glossary source dir is empty/absent", () => {
    // Fresh temp root with no glossary files at all.
    const emptyRoot = mkdtempSync(join(tmpdir(), "gloss-ids-empty-"));
    try {
      expect(() => readGlossaryIdsSync(emptyRoot)).toThrow(/no glossary canonical ids parsed/);
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });
});
