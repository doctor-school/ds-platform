"use client";

import * as React from "react";
import type { Extensions, JSONContent } from "@tiptap/core";
import LinkExtension from "@tiptap/extension-link";
import { OrderedList } from "@tiptap/extension-list";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  MATERIAL_BODY_HEADING_LEVELS,
  MATERIAL_BODY_LINK_PROTOCOLS,
  isAllowedMaterialLinkHref,
  type MaterialBody,
} from "@ds/schemas";

import { cn } from "../lib/utils";
import { Button } from "./button";
import { FilterChip } from "./filter-chip";
import { Input } from "./input";

/**
 * `RichTextEditor` (048 EARS-2, #3511) — the admin rich-text editor of a
 * material body. An approved-non-canvas admin primitive: the toolbar is the
 * allowlist, the surface is the `Textarea` field family (one control language
 * across the admin form).
 *
 * One allowlist, three consumers (048-design.md §Rich-text body): the editor
 * registers EXACTLY the TipTap extensions of the `@ds/schemas` body set —
 * StarterKit trimmed to it (no code, code block, horizontal rule, strike,
 * underline) plus Link with the protocols limited and `autolink` on. Because
 * ProseMirror parses a paste through that schema, a fragment from Word or a
 * browser loses images, tables, colours and fonts by construction, not by a
 * sanitiser. Two attribute sets are narrowed to the contract as well: a link
 * carries `href` only (TipTap's default `target` / `rel` / `class` are dropped
 * — the renderer derives the target from the host), an ordered list `start`
 * only (≥ 1). So every document `onChange` emits parses with
 * `materialBodySchema`; the API still refuses one that does not.
 *
 * Copy: default RU strings in `RICH_TEXT_EDITOR_COPY`, overridable per key.
 */

export interface RichTextEditorCopy {
  toolbar: string;
  bold: string;
  italic: string;
  heading2: string;
  heading3: string;
  bulletList: string;
  orderedList: string;
  blockquote: string;
  link: string;
  linkField: string;
  linkPlaceholder: string;
  linkApply: string;
  linkRemove: string;
  linkInvalid: string;
}

export const RICH_TEXT_EDITOR_COPY: RichTextEditorCopy = {
  toolbar: "Форматирование текста",
  bold: "Жирный",
  italic: "Курсив",
  heading2: "Заголовок",
  heading3: "Подзаголовок",
  bulletList: "Список",
  orderedList: "Нумерованный список",
  blockquote: "Цитата",
  link: "Ссылка",
  linkField: "Адрес ссылки",
  linkPlaceholder: "https://…",
  linkApply: "Применить",
  linkRemove: "Убрать ссылку",
  linkInvalid:
    "Укажите полный адрес, начинающийся с https://, http:// или mailto:",
};

export interface RichTextEditorProps {
  value: MaterialBody;
  onChange: (body: MaterialBody) => void;
  id?: string;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  copy?: Partial<RichTextEditorCopy>;
  className?: string;
}

type ToolKey =
  | "bold"
  | "italic"
  | "heading2"
  | "heading3"
  | "bulletList"
  | "orderedList"
  | "blockquote"
  | "link";

/** Link narrowed to the contract: `href` only, judged by the shared rule. */
const MaterialLink = LinkExtension.extend({
  addAttributes() {
    return {
      href: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("href"),
      },
    };
  },
}).configure({
  autolink: true,
  openOnClick: false,
  linkOnPaste: true,
  protocols: MATERIAL_BODY_LINK_PROTOCOLS.map((p) => p.slice(0, -1)),
  defaultProtocol: "https",
  isAllowedUri: (url) => isAllowedMaterialLinkHref(url),
  shouldAutoLink: (url) => isAllowedMaterialLinkHref(url),
  HTMLAttributes: { target: null, rel: null, class: null },
});

/** Ordered list narrowed to the contract: `start` only, never below 1. */
const MaterialOrderedList = OrderedList.extend({
  addAttributes() {
    return {
      start: {
        default: 1,
        parseHTML: (element: HTMLElement) => {
          const start = Number.parseInt(
            element.getAttribute("start") ?? "",
            10,
          );
          return Number.isInteger(start) && start >= 1 ? start : 1;
        },
      },
    };
  },
});

function materialBodyExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [...MATERIAL_BODY_HEADING_LEVELS] },
      code: false,
      codeBlock: false,
      horizontalRule: false,
      strike: false,
      underline: false,
      link: false,
      orderedList: false,
    }),
    MaterialLink,
    MaterialOrderedList,
  ];
}

/* form-rhythm-ok: `min-h-48` is the editing surface's own minimum height (a
   multi-line field starts taller than one row, as `Textarea`'s `min-h-24`),
   not a reserved slot on a form-message element. */
const SURFACE = cn(
  "min-h-48 w-full border-2 border-hairline bg-card px-3.5 py-3 text-sm text-foreground transition-colors",
  "hover:border-ring focus-visible:border-ring focus-visible:shadow-focus focus-visible:outline-none",
  "aria-invalid:border-destructive-text aria-invalid:bg-destructive-tint",
  "aria-disabled:cursor-not-allowed aria-disabled:bg-muted aria-disabled:text-muted-foreground",
  // Block rhythm and node shapes inside the field — the editor's own
  // ProseMirror DOM, styled from here so an editor reads the structure it
  // writes (heading steps, list markers, the quote rule) at the field's size.
  "flex flex-col gap-2",
  "[&_h2]:text-lg [&_h2]:leading-tight [&_h2]:font-extrabold",
  "[&_h3]:text-lead [&_h3]:leading-snug [&_h3]:font-extrabold",
  "[&_strong]:font-extrabold [&_a]:font-bold [&_a]:text-primary-action [&_a]:underline [&_a]:underline-offset-4",
  "[&_ul]:list-disc [&_ul]:pl-5.5 [&_ol]:list-decimal [&_ol]:pl-5.5 [&_li]:mt-1",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:font-bold",
);

const RichTextEditor = React.forwardRef<HTMLDivElement, RichTextEditorProps>(
  (
    {
      value,
      onChange,
      id,
      disabled = false,
      "aria-label": ariaLabel,
      "aria-labelledby": ariaLabelledBy,
      "aria-describedby": ariaDescribedBy,
      "aria-invalid": ariaInvalid,
      copy: copyOverride,
      className,
    },
    ref,
  ) => {
    const copy = { ...RICH_TEXT_EDITOR_COPY, ...copyOverride };
    const onChangeRef = React.useRef(onChange);
    onChangeRef.current = onChange;
    const emitted = React.useRef<MaterialBody | null>(null);

    const attributes: Record<string, string> = {
      class: SURFACE,
      role: "textbox",
      "aria-multiline": "true",
    };
    if (id) attributes.id = id;
    if (ariaLabel) attributes["aria-label"] = ariaLabel;
    if (ariaLabelledBy) attributes["aria-labelledby"] = ariaLabelledBy;
    if (ariaDescribedBy) attributes["aria-describedby"] = ariaDescribedBy;
    if (ariaInvalid) attributes["aria-invalid"] = "true";
    if (disabled) attributes["aria-disabled"] = "true";

    const editor = useEditor({
      extensions: materialBodyExtensions(),
      content: value as JSONContent,
      editable: !disabled,
      immediatelyRender: false,
      editorProps: { attributes },
      onUpdate: ({ editor: current }) => {
        const next = current.getJSON() as MaterialBody;
        emitted.current = next;
        onChangeRef.current(next);
      },
    });

    // Keep the DOM attributes and editability in step with the props.
    React.useEffect(() => {
      if (!editor) return;
      editor.setOptions({ editorProps: { attributes } });
      editor.setEditable(!disabled, false);
    }, [
      editor,
      disabled,
      id,
      ariaLabel,
      ariaLabelledBy,
      ariaDescribedBy,
      ariaInvalid,
    ]);

    // An outside value (a reset, a loaded draft) replaces the content; the
    // value this editor just emitted does not.
    React.useEffect(() => {
      if (!editor || value === emitted.current) return;
      editor.commands.setContent(value as JSONContent, { emitUpdate: false });
    }, [editor, value]);

    const active = useEditorState({
      editor,
      selector: ({ editor: e }) => ({
        bold: e?.isActive("bold") ?? false,
        italic: e?.isActive("italic") ?? false,
        heading2: e?.isActive("heading", { level: 2 }) ?? false,
        heading3: e?.isActive("heading", { level: 3 }) ?? false,
        bulletList: e?.isActive("bulletList") ?? false,
        orderedList: e?.isActive("orderedList") ?? false,
        blockquote: e?.isActive("blockquote") ?? false,
        link: e?.isActive("link") ?? false,
      }),
    });

    const [linkOpen, setLinkOpen] = React.useState(false);
    const [linkHref, setLinkHref] = React.useState("");
    const [linkError, setLinkError] = React.useState(false);
    const linkFieldId = `${React.useId()}-link`;

    const openLink = () => {
      const current = editor?.getAttributes("link").href;
      setLinkHref(typeof current === "string" ? current : "");
      setLinkError(false);
      setLinkOpen((open) => !open);
    };
    const applyLink = () => {
      if (!editor) return;
      const href = linkHref.trim();
      if (!isAllowedMaterialLinkHref(href)) {
        setLinkError(true);
        return;
      }
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
      setLinkError(false);
      setLinkOpen(false);
    };
    const removeLink = () => {
      editor?.chain().focus().extendMarkRange("link").unsetLink().run();
      setLinkOpen(false);
    };

    const tools: {
      key: ToolKey;
      run: () => void;
    }[] = [
      { key: "bold", run: () => editor?.chain().focus().toggleBold().run() },
      {
        key: "italic",
        run: () => editor?.chain().focus().toggleItalic().run(),
      },
      {
        key: "heading2",
        run: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
      },
      {
        key: "heading3",
        run: () => editor?.chain().focus().toggleHeading({ level: 3 }).run(),
      },
      {
        key: "bulletList",
        run: () => editor?.chain().focus().toggleBulletList().run(),
      },
      {
        key: "orderedList",
        run: () => editor?.chain().focus().toggleOrderedList().run(),
      },
      {
        key: "blockquote",
        run: () => editor?.chain().focus().toggleBlockquote().run(),
      },
      { key: "link", run: openLink },
    ];

    return (
      <div ref={ref} className={cn("flex w-full flex-col gap-2", className)}>
        <div
          role="toolbar"
          aria-label={copy.toolbar}
          className="flex flex-wrap gap-1.5"
        >
          {tools.map((tool) => (
            <FilterChip
              key={tool.key}
              selected={
                tool.key === "link"
                  ? linkOpen || Boolean(active?.link)
                  : Boolean(active?.[tool.key])
              }
              disabled={disabled || !editor}
              onMouseDown={(event) => event.preventDefault()}
              onClick={tool.run}
            >
              {copy[tool.key]}
            </FilterChip>
          ))}
        </div>
        {linkOpen ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id={linkFieldId}
                type="url"
                inputMode="url"
                aria-label={copy.linkField}
                aria-invalid={linkError || undefined}
                aria-describedby={
                  linkError ? `${linkFieldId}-error` : undefined
                }
                placeholder={copy.linkPlaceholder}
                value={linkHref}
                onChange={(event) => {
                  setLinkHref(event.target.value);
                  setLinkError(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applyLink();
                  }
                }}
              />
              <Button type="button" size="field" onClick={applyLink}>
                {copy.linkApply}
              </Button>
              {active?.link ? (
                <Button
                  type="button"
                  size="field"
                  variant="outline"
                  onClick={removeLink}
                >
                  {copy.linkRemove}
                </Button>
              ) : null}
            </div>
            {linkError ? (
              <p
                id={`${linkFieldId}-error`}
                role="alert"
                className="text-xs text-destructive-text"
              >
                {copy.linkInvalid}
              </p>
            ) : null}
          </div>
        ) : null}
        <EditorContent editor={editor} />
      </div>
    );
  },
);
RichTextEditor.displayName = "RichTextEditor";

export { RichTextEditor, materialBodyExtensions };
