import { describe, expect, it } from "vitest";

import {
  MATERIAL_BODY_LIMITS,
  MATERIAL_BODY_MARK_TYPES,
  MATERIAL_BODY_NODE_TYPES,
  bodyText,
  emptyMaterialBody,
  isAllowedMaterialLinkHref,
  materialBodySchema,
} from "./material-body.js";

/**
 * 048 EARS-2 / V-1 — the allowlisted body contract (048-design.md §Rich-text
 * body). One allowlist, three consumers: this schema, `RichTextEditor` and
 * `RichTextContent` (packages/design-system).
 */

const p = (...content: unknown[]) => ({ type: "paragraph", content });
const t = (text: string, marks?: unknown[]) =>
  marks ? { type: "text", text, marks } : { type: "text", text };
const doc = (...content: unknown[]) => ({ type: "doc", content });
const link = (href: string) => ({ type: "link", attrs: { href } });

/** A document carrying every allowlisted node and mark once. */
const everyNode = doc(
  { type: "heading", attrs: { level: 2 }, content: [t("Раздел")] },
  { type: "heading", attrs: { level: 3 }, content: [t("Подраздел")] },
  p(
    t("Обычный "),
    t("жирный", [{ type: "bold" }]),
    t(" и "),
    t("курсив", [{ type: "italic" }]),
    { type: "hardBreak" },
    t("ссылка", [link("https://academy.doctor.school/events")]),
    t(" почта", [link("mailto:info@doctor.school")]),
    t(" сайт", [link("http://example.org/a?b=1")]),
  ),
  p(),
  {
    type: "bulletList",
    content: [{ type: "listItem", content: [p(t("пункт"))] }],
  },
  {
    type: "orderedList",
    attrs: { start: 3 },
    content: [{ type: "listItem", content: [p(t("шаг"))] }],
  },
  { type: "blockquote", content: [p(t("Цитата"))] },
);

const refused = (value: unknown) =>
  expect(materialBodySchema.safeParse(value).success).toBe(false);

/** Nest `levels` blockquotes around one paragraph. */
const nestedQuotes = (levels: number) => {
  let node: unknown = p(t("x"));
  for (let i = 0; i < levels; i += 1)
    node = { type: "blockquote", content: [node] };
  return doc(node);
};

describe("048 EARS-2: material body contract", () => {
  it("048 EARS-2: the allowlist is exactly the design table", () => {
    expect([...MATERIAL_BODY_NODE_TYPES].sort()).toEqual(
      [
        "blockquote",
        "bulletList",
        "doc",
        "hardBreak",
        "heading",
        "listItem",
        "orderedList",
        "paragraph",
        "text",
      ].sort(),
    );
    expect([...MATERIAL_BODY_MARK_TYPES].sort()).toEqual(
      ["bold", "italic", "link"].sort(),
    );
    expect(MATERIAL_BODY_LIMITS).toEqual({
      textCharacters: 60_000,
      nodes: 2_000,
      depth: 6,
      linkHref: 2_048,
    });
  });

  it("048 EARS-2: when a body carries every allowlisted node and mark, the system shall accept it", () => {
    const parsed = materialBodySchema.safeParse(everyNode);
    expect(parsed.success).toBe(true);
    expect(materialBodySchema.safeParse(emptyMaterialBody()).success).toBe(
      true,
    );
  });

  it("048 EARS-2: when a body carries another node, the system shall refuse it", () => {
    refused(doc({ type: "image", attrs: { src: "https://x.ru/a.png" } }));
    refused(doc({ type: "table", content: [] }));
    refused(doc({ type: "codeBlock", content: [t("x")] }));
    refused(doc({ type: "horizontalRule" }));
    refused({ type: "paragraph", content: [t("not a doc")] });
  });

  it("048 EARS-2: when a body carries another mark or attribute, the system shall refuse it", () => {
    refused(doc(p(t("x", [{ type: "underline" }]))));
    refused(doc(p(t("x", [{ type: "textStyle", attrs: { color: "red" } }]))));
    refused(
      doc(
        p(
          t("x", [
            { type: "link", attrs: { href: "https://a.ru", target: "_top" } },
          ]),
        ),
      ),
    );
    refused(doc({ type: "heading", attrs: { level: 1 }, content: [t("h")] }));
    refused(doc({ type: "heading", attrs: { level: 4 }, content: [t("h")] }));
    refused(
      doc({
        type: "orderedList",
        attrs: { start: 0 },
        content: [{ type: "listItem", content: [p(t("x"))] }],
      }),
    );
    refused(doc({ type: "paragraph", attrs: { textAlign: "center" } }));
    refused(doc(p({ type: "text", text: "x", style: "color:red" })));
  });

  it("048 EARS-2: when a link target is not an absolute https/http/mailto address, the system shall refuse it", () => {
    for (const href of [
      "javascript:alert(1)",
      "/materials/a",
      "academy.doctor.school",
      "data:text/html,<b>x</b>",
      "ftp://example.org",
      "https://",
      "mailto:",
    ]) {
      expect(isAllowedMaterialLinkHref(href)).toBe(false);
      refused(doc(p(t("x", [link(href)]))));
    }
  });

  it("048 EARS-2: when a link target is longer than 2048 characters, the system shall refuse it", () => {
    const base = "https://example.org/";
    const atLimit = base + "a".repeat(2048 - base.length);
    expect(
      materialBodySchema.safeParse(doc(p(t("x", [link(atLimit)])))).success,
    ).toBe(true);
    refused(doc(p(t("x", [link(atLimit + "a")]))));
  });

  it("048 EARS-2: when a body has more than 60 000 characters of text, the system shall refuse it", () => {
    const half = "а".repeat(30_000);
    expect(
      materialBodySchema.safeParse(doc(p(t(half)), p(t(half)))).success,
    ).toBe(true);
    refused(doc(p(t(half)), p(t(half + "а"))));
  });

  it("048 EARS-2: when a body has more than 2 000 nodes, the system shall refuse it", () => {
    // doc + N × (paragraph + text) nodes.
    const paragraphs = (n: number) =>
      Array.from({ length: n }, () => p(t("x")));
    expect(materialBodySchema.safeParse(doc(...paragraphs(999))).success).toBe(
      true,
    ); // 1 + 1998 = 1999
    refused(doc(...paragraphs(1000))); // 1 + 2000 = 2001
  });

  it("048 EARS-2: when a body nests deeper than 6 levels, the system shall refuse it", () => {
    // 5 quotes + the paragraph = 6 block levels.
    expect(materialBodySchema.safeParse(nestedQuotes(5)).success).toBe(true);
    refused(nestedQuotes(6));
    // A pathological depth is refused, never a stack overflow.
    refused(nestedQuotes(50_000));
  });

  it("048 EARS-2: bodyText returns the plain text of the document, blocks on their own lines", () => {
    expect(bodyText(everyNode)).toBe(
      [
        "Раздел",
        "Подраздел",
        "Обычный жирный и курсив\nссылка почта сайт",
        "",
        "пункт",
        "шаг",
        "Цитата",
      ].join("\n"),
    );
    expect(bodyText(emptyMaterialBody()).trim()).toBe("");
  });
});
