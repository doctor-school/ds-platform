import { z } from "zod";

/**
 * 048 EARS-2 — the material body contract (048-design.md §Rich-text body,
 * Lead decisions 6, 16, 23).
 *
 * A material body is a ProseMirror JSON document of exactly the allowlisted
 * node and mark set below — never HTML. One allowlist, three consumers:
 *
 *  - this schema — the API refuses any document it rejects (`400`, field `body`);
 *  - `RichTextEditor` (`@ds/design-system/rich-text-editor`) registers exactly
 *    the TipTap extensions of this set, so a paste drops everything else;
 *  - `RichTextContent` (`@ds/design-system/rich-text-content`) walks only this
 *    set and renders nothing it does not know.
 *
 * The bounds are on the JSON a request can make the renderer walk. NESTING
 * DEPTH counts block levels below `doc`: a top-level paragraph is level 1, a
 * paragraph in a list item of a top-level list is level 3; inline leaves (text,
 * hard break) add no level. The depth is enforced STRUCTURALLY — the schema of
 * a block at level 6 admits no block children — so a pathologically deep
 * document is refused at level 7 without walking the rest.
 */

export const MATERIAL_BODY_NODE_TYPES = [
  "doc",
  "paragraph",
  "text",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "hardBreak",
] as const;
export type MaterialBodyNodeType = (typeof MATERIAL_BODY_NODE_TYPES)[number];

export const MATERIAL_BODY_MARK_TYPES = ["bold", "italic", "link"] as const;
export type MaterialBodyMarkType = (typeof MATERIAL_BODY_MARK_TYPES)[number];

/** Heading levels: the page title is the only level 1. */
export const MATERIAL_BODY_HEADING_LEVELS = [2, 3] as const;

/** Allowed link protocols (URL `protocol`, colon included). */
export const MATERIAL_BODY_LINK_PROTOCOLS = [
  "https:",
  "http:",
  "mailto:",
] as const;

export const MATERIAL_BODY_LIMITS = {
  /** Characters of text across the whole document (a long column ≈ 20 000). */
  textCharacters: 60_000,
  /** Every node of the document, `doc` and text nodes included. */
  nodes: 2_000,
  /** Block levels below `doc`. */
  depth: 6,
  /** Characters of one link `href`. */
  linkHref: 2_048,
} as const;

/**
 * The link rule as a PATTERN, not a WHATWG `new URL()` parse: this package is
 * the environment-agnostic contract SSOT compiled against `lib: ES2022` alone
 * (the `PARTNER_WEBSITE_URL_PATTERN` precedent in `taxonomy.schema.ts`). An
 * `http(s)` address needs a host before any path, query or fragment; a
 * `mailto:` address needs a recipient; no whitespace or control character
 * anywhere. The scheme is an allow-list, so `javascript:` / `data:` / relative
 * targets never match.
 */
export const MATERIAL_BODY_LINK_PATTERN =
  // eslint-disable-next-line no-control-regex
  /^(?:https?:\/\/[^\s\x00-\x1f/?#]+[^\s\x00-\x1f]*|mailto:[^\s\x00-\x1f]+)$/i;

/**
 * An absolute `https:` / `http:` address with a host, or a `mailto:` address
 * with a recipient, at most 2048 characters. Shared by the schema, the editor's
 * link input and the renderer, so a stored or pasted link is judged once.
 */
export function isAllowedMaterialLinkHref(href: string): boolean {
  if (href.length === 0 || href.length > MATERIAL_BODY_LIMITS.linkHref)
    return false;
  return MATERIAL_BODY_LINK_PATTERN.test(href);
}

const boldMark = z.strictObject({ type: z.literal("bold") });
const italicMark = z.strictObject({ type: z.literal("italic") });
const linkMark = z.strictObject({
  type: z.literal("link"),
  attrs: z.strictObject({
    href: z
      .string()
      .max(MATERIAL_BODY_LIMITS.linkHref)
      .refine(isAllowedMaterialLinkHref, {
        message:
          "link target must be an absolute https:, http: or mailto: address",
      }),
  }),
});

export const materialBodyMarkSchema = z.discriminatedUnion("type", [
  boldMark,
  italicMark,
  linkMark,
]);
export type MaterialBodyMark = z.infer<typeof materialBodyMarkSchema>;

const marks = z.array(materialBodyMarkSchema).optional();

const textNode = z.strictObject({
  type: z.literal("text"),
  text: z.string().min(1),
  marks,
});
const hardBreakNode = z.strictObject({
  type: z.literal("hardBreak"),
  marks,
});

export const materialBodyInlineSchema = z.discriminatedUnion("type", [
  textNode,
  hardBreakNode,
]);
export type MaterialBodyText = z.infer<typeof textNode>;
export type MaterialBodyHardBreak = z.infer<typeof hardBreakNode>;
export type MaterialBodyInline = z.infer<typeof materialBodyInlineSchema>;

const inlineContent = z.array(materialBodyInlineSchema).optional();

const paragraphNode = z.strictObject({
  type: z.literal("paragraph"),
  content: inlineContent,
});
const headingNode = z.strictObject({
  type: z.literal("heading"),
  attrs: z.strictObject({
    level: z.union([z.literal(2), z.literal(3)]),
  }),
  content: inlineContent,
});

export type MaterialBodyParagraph = z.infer<typeof paragraphNode>;
export type MaterialBodyHeading = z.infer<typeof headingNode>;
export interface MaterialBodyListItem {
  type: "listItem";
  content: MaterialBodyBlock[];
}
export interface MaterialBodyBulletList {
  type: "bulletList";
  content: MaterialBodyListItem[];
}
export interface MaterialBodyOrderedList {
  type: "orderedList";
  attrs?: { start: number } | undefined;
  content: MaterialBodyListItem[];
}
export interface MaterialBodyBlockquote {
  type: "blockquote";
  content: MaterialBodyBlock[];
}
export type MaterialBodyBlock =
  | MaterialBodyParagraph
  | MaterialBodyHeading
  | MaterialBodyBulletList
  | MaterialBodyOrderedList
  | MaterialBodyBlockquote;
export interface MaterialBody {
  type: "doc";
  content: MaterialBodyBlock[];
}
export type MaterialBodyNode =
  MaterialBody | MaterialBodyBlock | MaterialBodyListItem | MaterialBodyInline;

/**
 * The block schema at a given level (1-based). Containers are offered only
 * while their children still fit within `MATERIAL_BODY_LIMITS.depth`.
 */
const blockSchemas = new Map<number, z.ZodType<MaterialBodyBlock>>();
function blockAt(level: number): z.ZodType<MaterialBodyBlock> {
  const cached = blockSchemas.get(level);
  if (cached) return cached;
  const { depth } = MATERIAL_BODY_LIMITS;
  const options: z.ZodType<MaterialBodyBlock>[] = [paragraphNode, headingNode];
  if (level + 1 <= depth) {
    options.push(
      z.strictObject({
        type: z.literal("blockquote"),
        content: z.array(blockAt(level + 1)).min(1),
      }),
    );
  }
  if (level + 2 <= depth) {
    const listItem = z.strictObject({
      type: z.literal("listItem"),
      content: z.array(blockAt(level + 2)).min(1),
    });
    const items = z.array(listItem).min(1);
    options.push(
      z.strictObject({ type: z.literal("bulletList"), content: items }),
      z.strictObject({
        type: z.literal("orderedList"),
        attrs: z.strictObject({ start: z.number().int().min(1) }).optional(),
        content: items,
      }),
    );
  }
  const schema = z.discriminatedUnion(
    "type",
    options as unknown as [
      z.ZodObject<{ type: z.ZodLiteral<string> }>,
      ...z.ZodObject<{ type: z.ZodLiteral<string> }>[],
    ],
  ) as unknown as z.ZodType<MaterialBodyBlock>;
  blockSchemas.set(level, schema);
  return schema;
}

/** Every node of the document, iteratively (the structure is already bounded). */
function* walk(root: MaterialBodyNode): Generator<MaterialBodyNode> {
  const stack: MaterialBodyNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as MaterialBodyNode;
    yield node;
    const content = (node as { content?: MaterialBodyNode[] }).content;
    if (content)
      for (let i = content.length - 1; i >= 0; i -= 1) stack.push(content[i]!);
  }
}

export const materialBodySchema: z.ZodType<MaterialBody> = z
  .strictObject({
    type: z.literal("doc"),
    content: z.array(blockAt(1)).min(1),
  })
  .superRefine((body, ctx) => {
    let nodes = 0;
    let characters = 0;
    for (const node of walk(body as MaterialBody)) {
      nodes += 1;
      if (node.type === "text") characters += node.text.length;
    }
    if (nodes > MATERIAL_BODY_LIMITS.nodes) {
      ctx.addIssue({
        code: "custom",
        message: `body must have at most ${MATERIAL_BODY_LIMITS.nodes} nodes`,
      });
    }
    if (characters > MATERIAL_BODY_LIMITS.textCharacters) {
      ctx.addIssue({
        code: "custom",
        message: `body must have at most ${MATERIAL_BODY_LIMITS.textCharacters} characters of text`,
      });
    }
  }) as unknown as z.ZodType<MaterialBody>;

/** A new material's body: one empty paragraph (what an empty editor holds). */
export function emptyMaterialBody(): MaterialBody {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

function inlineText(content: MaterialBodyInline[] | undefined): string {
  if (!content) return "";
  return content
    .map((node) => (node.type === "text" ? node.text : "\n"))
    .join("");
}

/**
 * The plain text of a body: every paragraph and heading on its own line, a hard
 * break as a newline. EARS-4 reads it for «a body with at least one character
 * of text» (`bodyText(doc).trim().length > 0`).
 */
export function bodyText(body: MaterialBody): string {
  const lines: string[] = [];
  for (const node of walk(body)) {
    if (node.type === "paragraph" || node.type === "heading")
      lines.push(inlineText(node.content));
  }
  return lines.join("\n");
}
