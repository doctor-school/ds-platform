import * as React from "react";
import {
  MATERIAL_BODY_HEADING_LEVELS,
  isAllowedMaterialLinkHref,
  type MaterialBody,
  type MaterialBodyBlock,
  type MaterialBodyInline,
  type MaterialBodyMark,
} from "@ds/schemas";

import { cn } from "../lib/utils";
import { Link } from "../primitives/link";

/**
 * `RichTextContent` (048 EARS-2 / EARS-12, #3511) — the ONE renderer of a
 * material body, shared by the Academy reading page (#3514) and the admin
 * preview (EARS-3). Canvas: `design-source/academy-material.dc.html`, the
 * «academy-material · текст» block (h2, h3, paragraph, strong, em, lists,
 * block quote, links as `Link variant="inline"`).
 *
 * The body is the allowlisted ProseMirror document of `@ds/schemas`
 * `material-body.ts` (048-design.md §Rich-text body, Lead decision 6). The
 * renderer walks ONLY that set into React elements — no HTML string is ever
 * produced or injected. Anything outside the set is dropped: an unknown node
 * renders nothing (its subtree included), an unknown mark leaves its text
 * plain, a link whose target fails the shared href rule is plain text. The API
 * refuses such a body before it is stored; the walk is the second line, so a
 * stale or hand-edited row can never reach the page as markup.
 *
 * Link targets: `academy.doctor.school` opens in the same tab; any other host
 * opens a new tab with `rel="noopener noreferrer"` and carries the canvas «↗»
 * (aria-hidden) after its text; `mailto:` stays in place.
 *
 * Typography maps the canvas onto existing DS tokens (no arbitrary values):
 * paragraph 15.5px / 1.75 / 500 → `text-body-compact` / `leading-relaxed` /
 * `font-medium`; strong 800 → `font-extrabold`; h2 clamp(19–23px) → `text-lg` →
 * `sm:text-xl`; h3 17px → `text-lead`; quote 18–21px / 700 → `text-lg` /
 * `font-bold`, a 2px top rule in `border`.
 */

/** Hosts whose links open in the same tab (048-design.md §Rich-text body). */
export const RICH_TEXT_SAME_TAB_HOSTS: readonly string[] = [
  "academy.doctor.school",
];

export interface RichTextContentProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children"
> {
  body: MaterialBody;
}

function linkTarget(href: string): { target?: string; rel?: string } {
  if (!/^https?:/i.test(href)) return {};
  let host = "";
  try {
    host = new URL(href).hostname.toLowerCase();
  } catch {
    return {};
  }
  return RICH_TEXT_SAME_TAB_HOSTS.includes(host)
    ? {}
    : { target: "_blank", rel: "noopener noreferrer" };
}

/** The allowed link target of a run, or `undefined` when it is not a link. */
function linkHref(
  marks: readonly MaterialBodyMark[] | undefined,
): string | undefined {
  for (const mark of marks ?? []) {
    if (
      mark.type === "link" &&
      typeof mark.attrs?.href === "string" &&
      isAllowedMaterialLinkHref(mark.attrs.href)
    )
      return mark.attrs.href;
  }
  return undefined;
}

function renderMarked(
  text: string,
  marks: readonly MaterialBodyMark[] | undefined,
  key: React.Key,
): React.ReactNode {
  let node: React.ReactNode = text;
  for (const mark of marks ?? []) {
    if (mark.type === "bold")
      node = <strong className="font-extrabold">{node}</strong>;
    else if (mark.type === "italic") node = <em>{node}</em>;
  }
  return <React.Fragment key={key}>{node}</React.Fragment>;
}

/**
 * Inline content. Adjacent text runs that share one link target (ProseMirror
 * splits a link wherever another mark starts or ends) render as ONE link, so a
 * link to another host carries the canvas «↗» once, after its whole text — the
 * canvas `runs()` appends ` ↗` to every `http(s)` link outside the Academy. The
 * glyph is `aria-hidden`: the accessible name stays the link text. U+FE0E
 * (text presentation) keeps it a text arrow in the link colour, as the canvas
 * draws it — the host font stacks name colour-emoji fonts, which would
 * otherwise draw U+2197 as an emoji tile.
 */
function renderInline(
  content: readonly MaterialBodyInline[] | undefined,
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const nodes = content ?? [];
  let index = 0;
  while (index < nodes.length) {
    const node = nodes[index]!;
    const key = index;
    if (node.type === "hardBreak") {
      out.push(<br key={key} />);
      index += 1;
      continue;
    }
    if (node.type !== "text" || typeof node.text !== "string") {
      index += 1;
      continue;
    }
    const href = linkHref(node.marks);
    if (href === undefined) {
      out.push(renderMarked(node.text, node.marks, key));
      index += 1;
      continue;
    }
    const runs: React.ReactNode[] = [];
    while (index < nodes.length) {
      const run = nodes[index]!;
      if (
        run.type !== "text" ||
        typeof run.text !== "string" ||
        linkHref(run.marks) !== href
      )
        break;
      runs.push(renderMarked(run.text, run.marks, index));
      index += 1;
    }
    const target = linkTarget(href);
    out.push(
      <Link key={key} variant="inline" href={href} {...target}>
        {runs}
        {target.target === "_blank" ? (
          <span aria-hidden="true">{" ↗\uFE0E"}</span>
        ) : null}
      </Link>,
    );
  }
  return out;
}

type Context = "body" | "quote" | "list";

const PARAGRAPH: Record<Context, string> = {
  body: "mb-3.5 text-reading leading-reading font-medium text-pretty text-foreground",
  list: "text-reading leading-reading-list font-medium text-pretty text-foreground",
  quote:
    "m-0 text-lg leading-normal font-bold tracking-tight text-pretty text-foreground sm:text-xl",
};

function renderBlocks(
  content: readonly MaterialBodyBlock[] | undefined,
  context: Context,
): React.ReactNode[] {
  return (content ?? []).map((node, index) =>
    renderBlock(node, context, index),
  );
}

function renderBlock(
  node: MaterialBodyBlock,
  context: Context,
  key: React.Key,
): React.ReactNode {
  switch (node.type) {
    case "paragraph":
      return (
        <p key={key} className={PARAGRAPH[context]}>
          {renderInline(node.content)}
        </p>
      );
    case "heading": {
      const level = node.attrs?.level;
      if (!(MATERIAL_BODY_HEADING_LEVELS as readonly number[]).includes(level))
        return null;
      return level === 2 ? (
        <h2
          key={key}
          className="mt-8 mb-4 text-lg leading-tight font-extrabold tracking-tight text-balance text-foreground sm:mt-11 sm:text-xl"
        >
          {renderInline(node.content)}
        </h2>
      ) : (
        <h3
          key={key}
          className="mt-6 mb-3 text-lead leading-snug font-extrabold tracking-tight text-foreground"
        >
          {renderInline(node.content)}
        </h3>
      );
    }
    case "bulletList":
    case "orderedList": {
      const items = (node.content ?? [])
        .filter((item) => item?.type === "listItem")
        .map((item, index) => (
          <li
            key={index}
            className="text-reading leading-reading-list font-medium text-pretty text-foreground"
          >
            {renderBlocks(item.content, "list")}
          </li>
        ));
      const listClass = "mb-4 flex flex-col gap-2 pl-5.5";
      if (node.type === "bulletList")
        return (
          <ul key={key} className={cn(listClass, "list-disc")}>
            {items}
          </ul>
        );
      const start = node.attrs?.start;
      return (
        <ol
          key={key}
          className={cn(listClass, "list-decimal")}
          start={
            typeof start === "number" && Number.isInteger(start) && start > 1
              ? start
              : undefined
          }
        >
          {items}
        </ol>
      );
    }
    case "blockquote":
      return (
        <blockquote
          key={key}
          className="my-6 flex flex-col gap-3 border-t-2 border-border pt-4 sm:my-8"
        >
          {renderBlocks(node.content, "quote")}
        </blockquote>
      );
    default:
      return null;
  }
}

const RichTextContent = React.forwardRef<HTMLDivElement, RichTextContentProps>(
  ({ body, className, ...props }, ref) => (
    <div ref={ref} className={cn("text-foreground", className)} {...props}>
      {body?.type === "doc" ? renderBlocks(body.content, "body") : null}
    </div>
  ),
);
RichTextContent.displayName = "RichTextContent";

export { RichTextContent };
