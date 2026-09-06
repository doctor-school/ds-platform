import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { LegalContentError } from "./errors.js";
import { listDocuments, loadDocument } from "./loader.js";

const fixtures = (name: string): string =>
  fileURLToPath(new URL(`./__fixtures__/${name}/`, import.meta.url));

const valid = { documentsDir: fixtures("valid") };

const scratchDirs: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "ds-legal-content-"));
  scratchDirs.push(dir);
  return dir;
};

afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

describe("@ds/legal-content loader", () => {
  it("028 EARS-9: a consent document resolves by its own slug, with frontmatter and body", () => {
    const document = loadDocument("consent-marketing", valid);

    expect(document).toBeDefined();
    expect(document?.slug).toBe("consent-marketing");
    expect(document?.frontmatter).toEqual({
      slug: "consent-marketing",
      title: "Согласие на маркетинговые сообщения",
      edition: "2026-02-20",
      kind: "consent",
    });
    expect(document?.body).toContain("Fixture — not a published document.");
    expect(document?.body).not.toContain("---");
  });

  it("028 EARS-9: each consent is its own document, never an index row inside another", () => {
    const consents = listDocuments("consent", valid);

    expect(consents.map((entry) => entry.slug)).toEqual(["consent-marketing"]);
    expect(listDocuments("policy", valid).map((entry) => entry.slug)).toEqual([
      "privacy-policy",
    ]);
  });

  it("028 EARS-10: republishing bumps edition in place — the same slug resolves to the new edition", () => {
    const documentsDir = scratch();
    const source = readFileSync(
      join(fixtures("valid"), "privacy-policy.md"),
      "utf8",
    );
    const file = join(documentsDir, "privacy-policy.md");
    writeFileSync(file, source, "utf8");

    const before = loadDocument("privacy-policy", { documentsDir });
    expect(before?.frontmatter.edition).toBe("2026-01-15");

    writeFileSync(
      file,
      source.replace("edition: 2026-01-15", "edition: 2026-03-01"),
      "utf8",
    );

    const after = loadDocument("privacy-policy", { documentsDir });
    expect(after?.slug).toBe("privacy-policy");
    expect(after?.frontmatter.edition).toBe("2026-03-01");
  });

  it("028 EARS-12: an unapproved document is absent, not a placeholder — the loader returns undefined", () => {
    expect(loadDocument("consent-photo-video", valid)).toBeUndefined();
  });

  it("028 EARS-12: list enumerates only files present — an empty documents dir lists nothing", () => {
    expect(listDocuments(undefined, { documentsDir: fixtures("empty") })).toEqual(
      [],
    );
  });

  it("028 EARS-12: a traversal-shaped slug never escapes the documents dir", () => {
    expect(loadDocument("../valid/privacy-policy", valid)).toBeUndefined();
    expect(loadDocument("Privacy_Policy", valid)).toBeUndefined();
  });

  it("028 V-1: an edition that is not a real calendar date is rejected", () => {
    expect(() =>
      listDocuments(undefined, { documentsDir: fixtures("bad-edition") }),
    ).toThrowError(LegalContentError);
    expect(() =>
      loadDocument("bad-edition", { documentsDir: fixtures("bad-edition") }),
    ).toThrowError(/bad-edition\.md/);
  });

  it("028 V-1: a kind outside policy | consent is rejected", () => {
    expect(() =>
      loadDocument("bad-kind", { documentsDir: fixtures("bad-kind") }),
    ).toThrowError(/kind/);
  });

  it("028 V-1: a frontmatter slug that disagrees with the filename is rejected", () => {
    expect(() =>
      loadDocument("consent-partner-data", {
        documentsDir: fixtures("slug-mismatch"),
      }),
    ).toThrowError(/consent-partner-data\.md/);
  });

  it("028 EARS-9: documents list in slug order", () => {
    expect(listDocuments(undefined, valid).map((entry) => entry.slug)).toEqual([
      "consent-marketing",
      "privacy-policy",
    ]);
  });
});
