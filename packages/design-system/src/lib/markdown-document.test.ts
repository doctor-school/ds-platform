import { describe, expect, it } from "vitest";

import POLICY_SOURCE from "../../../legal-content/documents/privacy-policy.md?raw";

import { parseLegalDocument } from "./markdown-document";

/**
 * 028 EARS-7 (#1966) — the Markdown→(ToC, body) helper the shared reading
 * component renders through. Exercised against the REAL published policy, not a
 * fixture: a legal document's shape (nine numbered `##` sections, ordered lists,
 * a GFM table) is the contract, and a hand-written fixture would let the helper
 * pass while the actual document renders wrong.
 */
/** The loader strips frontmatter; here we do the same minimal cut. */
function bodyOf(raw: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(raw);
  return match ? raw.slice(match[0].length) : raw;
}

const POLICY_BODY = bodyOf(POLICY_SOURCE);

describe("parseLegalDocument", () => {
  it("028 EARS-7: builds a table of contents from the real policy headings", () => {
    const { toc } = parseLegalDocument(POLICY_BODY);

    expect(toc.length).toBeGreaterThanOrEqual(9);
    expect(toc[0]?.text).toBe("1. Общие положения");
    expect(toc.every((entry) => entry.depth === 2 || entry.depth === 3)).toBe(
      true,
    );
  });

  it("028 EARS-7: every heading id is non-empty and unique, so no anchor collides", () => {
    const { toc } = parseLegalDocument(POLICY_BODY);
    const ids = toc.map((entry) => entry.id);

    expect(ids.every((id) => id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("028 EARS-7: de-duplicates ids when two headings carry the same text", () => {
    const { toc } = parseLegalDocument(
      "## Условия\n\nа\n\n## Условия\n\nб\n",
    );

    expect(toc.map((entry) => entry.id)).toEqual(["условия", "условия-1"]);
  });

  it("028 EARS-7: leaves an `h1` out of the table of contents — the page title owns it", () => {
    const { toc } = parseLegalDocument("# Заголовок\n\n## Раздел\n\nтекст\n");

    expect(toc.map((entry) => entry.text)).toEqual(["Раздел"]);
  });

  it("028 EARS-7: returns an empty table of contents for a document with no headings", () => {
    const { toc, content } = parseLegalDocument("Просто текст согласия.\n");

    expect(toc).toEqual([]);
    expect(content).toBeDefined();
  });
});
