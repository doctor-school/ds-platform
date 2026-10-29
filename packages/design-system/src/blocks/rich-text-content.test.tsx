import * as React from "react";
import { render, screen } from "@testing-library/react";
import type { MaterialBody } from "@ds/schemas";

import { RichTextContent } from "./rich-text-content";
import RENDERER_SOURCE from "./rich-text-content.tsx?raw";

/**
 * 048 EARS-2 / EARS-12, V-7 — the shared rich-text renderer. It walks only the
 * allowlisted set of `@ds/schemas` `material-body.ts`, renders React elements
 * (never HTML) and applies the link target rule of 048-design.md §Rich-text body.
 */

const body: MaterialBody = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Раздел" }],
    },
    {
      type: "heading",
      attrs: { level: 3 },
      content: [{ type: "text", text: "Подраздел" }],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Обычный " },
        { type: "text", text: "жирный", marks: [{ type: "bold" }] },
        { type: "text", text: "курсив", marks: [{ type: "italic" }] },
        { type: "hardBreak" },
        {
          type: "text",
          text: "своя",
          marks: [
            {
              type: "link",
              attrs: { href: "https://academy.doctor.school/events" },
            },
          ],
        },
        {
          type: "text",
          text: "чужая",
          marks: [{ type: "link", attrs: { href: "https://example.org/a" } }],
        },
        {
          type: "text",
          text: "почта",
          marks: [
            { type: "link", attrs: { href: "mailto:info@doctor.school" } },
          ],
        },
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "пункт" }] },
          ],
        },
      ],
    },
    {
      type: "orderedList",
      attrs: { start: 3 },
      content: [
        {
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "шаг" }] },
          ],
        },
      ],
    },
    {
      type: "blockquote",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Цитата" }] },
      ],
    },
  ],
};

describe("048 EARS-2: RichTextContent", () => {
  it("048 EARS-2: when given an allowlisted body, the renderer shall render every node and mark as its element", () => {
    const { container } = render(<RichTextContent body={body} />);
    expect(
      screen.getByRole("heading", { level: 2, name: "Раздел" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 3, name: "Подраздел" }),
    ).toBeTruthy();
    expect(container.querySelector("strong")?.textContent).toBe("жирный");
    expect(container.querySelector("em")?.textContent).toBe("курсив");
    expect(container.querySelector("p br")).toBeTruthy();
    expect(container.querySelector("ul > li")?.textContent).toBe("пункт");
    const ol = container.querySelector("ol");
    expect(ol?.getAttribute("start")).toBe("3");
    expect(ol?.textContent).toBe("шаг");
    expect(container.querySelector("blockquote")?.textContent).toBe("Цитата");
  });

  it("048 EARS-2: an academy link opens in the same tab, another host in a new tab with noopener noreferrer", () => {
    render(<RichTextContent body={body} />);
    const own = screen.getByRole("link", { name: "своя" });
    expect(own.getAttribute("href")).toBe(
      "https://academy.doctor.school/events",
    );
    expect(own.hasAttribute("target")).toBe(false);
    expect(own.hasAttribute("rel")).toBe(false);
    const other = screen.getByRole("link", { name: "чужая" });
    expect(other.getAttribute("target")).toBe("_blank");
    expect(other.getAttribute("rel")).toBe("noopener noreferrer");
    const mail = screen.getByRole("link", { name: "почта" });
    expect(mail.hasAttribute("target")).toBe(false);
  });

  it("048 EARS-2: when a body carries a node, mark or link outside the allowlist, the renderer shall drop it", () => {
    const hostile = {
      type: "doc",
      content: [
        { type: "image", attrs: { src: "https://x.ru/a.png" } },
        {
          type: "table",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "в таблице" }],
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "подчёркнуто",
              marks: [{ type: "underline" }],
            },
            {
              type: "text",
              text: "скрипт",
              marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
            },
            { type: "mention", attrs: { id: "x" } },
          ],
        },
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "h1" }],
        },
      ],
    } as unknown as MaterialBody;
    const { container } = render(<RichTextContent body={hostile} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).not.toContain("в таблице");
    expect(container.querySelector("u")).toBeNull();
    // The text of an unknown mark survives as plain text; a refused link is no link.
    expect(container.textContent).toContain("подчёркнуто");
    expect(container.textContent).toContain("скрипт");
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("h1")).toBeNull();
  });

  it("048 EARS-2: the renderer never sets HTML", () => {
    const source = RENDERER_SOURCE;
    expect(source).not.toMatch(/dangerouslySetInnerHTML\s*=/);
    expect(source).not.toMatch(/innerHTML/);
  });
});
