import * as React from "react";
import GithubSlugger from "github-slugger";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/**
 * `parseLegalDocument` (028 EARS-7, #1966) — the ONE place a legal document's
 * Markdown body becomes a table of contents plus a rendered React tree.
 *
 * WHY A HAND-WRITTEN mdast RENDERER RATHER THAN `react-markdown`.
 * `react-markdown` is not in the lockfile, while `unified@11` + `remark-parse@11`
 * + `remark-gfm@4` + `github-slugger@2` already are (the `apps/docs` Fumadocs
 * toolchain resolves exactly these pins), so the parse half costs no new package
 * version at all. The render half is deliberate rather than generic: the canvas
 * (`design-source/document.dc.html` L186-224) does not want default HTML — every
 * element carries design-system typography tokens, and a GFM table has to sit in
 * its own `overflow-x` container so a wide table scrolls inside the reading
 * column instead of widening the page. A component map handed to `react-markdown`
 * would be the same amount of code plus a dependency plus a second AST dialect
 * (hast) to reason about, so the mdast walk IS the cheaper contract.
 *
 * Pure and synchronous: no fetching, no `dangerouslySetInnerHTML` (raw HTML in a
 * document body is dropped, not injected), no client hooks. The ToC ids come from
 * `github-slugger`, which de-duplicates repeated headings within one document, so
 * an anchor is stable for as long as the heading text is.
 */

export interface LegalDocumentTocEntry {
  /** DOM id of the heading — the `#anchor` target. */
  id: string;
  /** Flattened heading text (inline emphasis stripped). */
  text: string;
  /** Markdown heading depth, 2 or 3 (an `h1` is the page title, not body). */
  depth: number;
}

export interface ParsedLegalDocument {
  toc: LegalDocumentTocEntry[];
  content: React.ReactNode;
}

type MdNode = { type: string; [key: string]: unknown };

const h = React.createElement;

/** Flatten a node's subtree to plain text (headings, table cells). */
function nodeText(node: MdNode): string {
  if (typeof node.value === "string") return node.value;
  const children = (node.children as MdNode[] | undefined) ?? [];
  return children.map(nodeText).join("");
}

const PARAGRAPH_CLASS =
  "mb-3.5 text-base leading-relaxed font-medium text-card-foreground";
const LIST_ITEM_CLASS =
  "text-base leading-relaxed font-medium text-card-foreground";

function renderInline(nodes: MdNode[], keyPrefix: string): React.ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (node.type) {
      case "text":
        return h(React.Fragment, { key }, String(node.value ?? ""));
      case "strong":
        return h(
          "strong",
          { key, className: "font-extrabold" },
          renderInline((node.children as MdNode[]) ?? [], key),
        );
      case "emphasis":
        return h(
          "em",
          { key },
          renderInline((node.children as MdNode[]) ?? [], key),
        );
      case "delete":
        return h(
          "s",
          { key },
          renderInline((node.children as MdNode[]) ?? [], key),
        );
      case "inlineCode":
        return h(
          "code",
          { key, className: "font-mono text-sm" },
          String(node.value ?? ""),
        );
      case "break":
        return h("br", { key });
      case "link": {
        const url = String(node.url ?? "");
        // A document body may link out (a regulator, the operator's mailbox).
        // An external destination opens in a new tab with the opener severed;
        // an in-document anchor stays in place.
        const external = /^https?:/i.test(url);
        return h(
          "a",
          {
            key,
            href: url,
            className:
              "font-bold text-primary-action underline underline-offset-4",
            ...(external
              ? { target: "_blank", rel: "noopener noreferrer" }
              : {}),
          },
          renderInline((node.children as MdNode[]) ?? [], key),
        );
      }
      default:
        return h(React.Fragment, { key }, nodeText(node));
    }
  });
}

function renderBlock(node: MdNode, key: string): React.ReactNode {
  switch (node.type) {
    case "paragraph":
      return h(
        "p",
        { key, className: PARAGRAPH_CLASS },
        renderInline((node.children as MdNode[]) ?? [], key),
      );
    case "list": {
      const ordered = node.ordered === true;
      const items = ((node.children as MdNode[]) ?? []).map((item, index) =>
        h(
          "li",
          { key: `${key}-i${index}`, className: LIST_ITEM_CLASS },
          ((item.children as MdNode[]) ?? []).map((child, childIndex) =>
            renderBlock(child, `${key}-i${index}-${childIndex}`),
          ),
        ),
      );
      return h(
        ordered ? "ol" : "ul",
        {
          key,
          className: ordered
            ? "mb-3.5 flex list-decimal flex-col gap-2.25 pl-5.5"
            : "mb-3.5 flex list-disc flex-col gap-2.25 pl-5.5",
        },
        items,
      );
    }
    case "blockquote":
      return h(
        "blockquote",
        { key, className: "mb-3.5 border-l-2 border-border pl-4" },
        ((node.children as MdNode[]) ?? []).map((child, index) =>
          renderBlock(child, `${key}-${index}`),
        ),
      );
    case "thematicBreak":
      return h("hr", { key, className: "my-6 border-t-2 border-hairline" });
    case "code":
      return h(
        "pre",
        { key, className: "mb-3.5 overflow-x-auto bg-section p-4 text-sm" },
        h("code", { className: "font-mono" }, String(node.value ?? "")),
      );
    case "table": {
      const rows = (node.children as MdNode[]) ?? [];
      const [headRow, ...bodyRows] = rows;
      // The canvas scrolls a wide table INSIDE its container so the page never
      // widens (document.dc.html L211-224).
      return h(
        "div",
        { key, className: "mb-3.5 overflow-x-auto border-2 border-border" },
        h(
          "table",
          { className: "w-full min-w-130 border-collapse text-sm" },
          headRow
            ? h(
                "thead",
                null,
                h(
                  "tr",
                  null,
                  ((headRow.children as MdNode[]) ?? []).map((cell, index) =>
                    h(
                      "th",
                      {
                        key: `${key}-th${index}`,
                        scope: "col",
                        className:
                          "border-b-2 border-border bg-section px-4 py-3 text-left text-2xs font-extrabold tracking-micro whitespace-nowrap text-faint uppercase",
                      },
                      renderInline(
                        (cell.children as MdNode[]) ?? [],
                        `${key}-th${index}`,
                      ),
                    ),
                  ),
                ),
              )
            : null,
          h(
            "tbody",
            null,
            bodyRows.map((row, rowIndex) =>
              h(
                "tr",
                { key: `${key}-r${rowIndex}` },
                ((row.children as MdNode[]) ?? []).map((cell, cellIndex) =>
                  h(
                    "td",
                    {
                      key: `${key}-r${rowIndex}-c${cellIndex}`,
                      className:
                        "border-b border-hairline px-4 py-3 align-top font-semibold text-card-foreground",
                    },
                    renderInline(
                      (cell.children as MdNode[]) ?? [],
                      `${key}-r${rowIndex}-c${cellIndex}`,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    }
    case "html":
      // Raw HTML in a legal document is DROPPED, never injected: the package is
      // a review-gated Markdown corpus, and an escape hatch into the DOM would
      // turn a content PR into a code PR.
      return null;
    default:
      return null;
  }
}

const HEADING_CLASS: Record<number, string> = {
  2: "mb-4 text-xl leading-snug font-extrabold tracking-tight text-card-foreground",
  3: "mb-3 text-lg leading-snug font-extrabold tracking-tight text-card-foreground",
};

export function parseLegalDocument(body: string): ParsedLegalDocument {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(body) as unknown as MdNode;
  const nodes = ((tree.children as MdNode[] | undefined) ?? []).filter(Boolean);

  const slugger = new GithubSlugger();
  const toc: LegalDocumentTocEntry[] = [];

  // Sections are cut at every heading, exactly as the canvas has them: one
  // `<section id>` per ToC entry so the anchor lands on the whole block, and a
  // leading preamble (text before the first heading) keeps its own unlabelled
  // section rather than being swallowed by the first one.
  type Section = { id?: string; heading?: MdNode; blocks: MdNode[] };
  const sections: Section[] = [];
  let current: Section = { blocks: [] };

  for (const node of nodes) {
    const depth = typeof node.depth === "number" ? node.depth : 0;
    if (node.type === "heading" && (depth === 2 || depth === 3)) {
      if (current.heading || current.blocks.length > 0) sections.push(current);
      const text = nodeText(node);
      const id = slugger.slug(text);
      toc.push({ id, text, depth });
      current = { id, heading: node, blocks: [] };
      continue;
    }
    current.blocks.push(node);
  }
  if (current.heading || current.blocks.length > 0) sections.push(current);

  const content = sections.map((section, index) => {
    const key = `s${index}`;
    const depth =
      section.heading && typeof section.heading.depth === "number"
        ? section.heading.depth
        : 2;
    return h(
      "section",
      { key, id: section.id, className: "mb-9" },
      section.heading
        ? h(
            `h${depth}`,
            { className: HEADING_CLASS[depth] ?? HEADING_CLASS[2] },
            renderInline((section.heading.children as MdNode[]) ?? [], key),
          )
        : null,
      section.blocks.map((block, blockIndex) =>
        renderBlock(block, `${key}-${blockIndex}`),
      ),
    );
  });

  return { toc, content };
}
