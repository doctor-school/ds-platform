import * as React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import {
  emptyMaterialBody,
  materialBodySchema,
  type MaterialBody,
} from "@ds/schemas";

import { RichTextEditor, RICH_TEXT_EDITOR_COPY } from "./rich-text-editor";

/**
 * 048 EARS-2 / V-7 — the rich-text editor primitive. It registers exactly the
 * TipTap extensions of the `@ds/schemas` body allowlist, so a paste drops
 * everything else by schema, and everything it emits parses with the body
 * contract.
 */

function setup(initial: MaterialBody = emptyMaterialBody()) {
  const changes: MaterialBody[] = [];
  function Harness() {
    const [value, setValue] = React.useState(initial);
    return (
      <RichTextEditor
        aria-label="Текст"
        value={value}
        onChange={(next) => {
          changes.push(next);
          setValue(next);
        }}
      />
    );
  }
  const utils = render(<Harness />);
  const surface = () =>
    utils.container.querySelector(".ProseMirror") as
      (HTMLElement & { editor?: Editor }) | null;
  return { ...utils, changes, surface, last: () => changes.at(-1) };
}

const types = (node: unknown, out: string[] = []): string[] => {
  const n = node as {
    type?: string;
    content?: unknown[];
    marks?: { type: string }[];
  };
  if (n.type) out.push(n.type);
  for (const m of n.marks ?? []) out.push(`mark:${m.type}`);
  for (const c of n.content ?? []) types(c, out);
  return out;
};

// `useEditor` destroys its editor on a deferred tick after unmount (StrictMode
// safety, @tiptap/react `scheduleDestroy`). Unmount here and let that tick run,
// so the #441 orphan-timer sweep sees no pending library timer.
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 20));
});

describe("048 EARS-2: RichTextEditor", () => {
  it("048 EARS-2: the toolbar offers only the allowlisted set", async () => {
    setup();
    const toolbar = await screen.findByRole("toolbar");
    const names = Array.from(toolbar.querySelectorAll("button")).map(
      (b) => b.getAttribute("aria-label") ?? b.textContent,
    );
    const c = RICH_TEXT_EDITOR_COPY;
    expect(names).toEqual([
      c.bold,
      c.italic,
      c.heading2,
      c.heading3,
      c.bulletList,
      c.orderedList,
      c.blockquote,
      c.link,
    ]);
  });

  it("048 EARS-2: when a fragment with a paragraph, an image and a table is pasted, the editor shall keep the paragraph and strip the rest", async () => {
    const { surface, last } = setup();
    await waitFor(() => expect(surface()?.editor).toBeTruthy());
    act(() => {
      surface()!.editor!.view.pasteHTML(
        // A real paste event; jsdom has no ClipboardEvent constructor.
        '<p>Абзац <span style="color:red;font-family:Comic Sans">текста</span></p>' +
          '<img src="https://x.ru/a.png" alt="картинка">' +
          "<table><tr><td>ячейка</td></tr></table>" +
          "<pre><code>код</code></pre><hr><u>подчёркнуто</u><s>зачёркнуто</s>",
        new Event("paste") as ClipboardEvent,
      );
    });
    const body = last()!;
    const seen = types(body);
    expect(seen).not.toContain("image");
    expect(seen).not.toContain("table");
    expect(seen).not.toContain("codeBlock");
    expect(seen).not.toContain("horizontalRule");
    expect(seen).not.toContain("mark:underline");
    expect(seen).not.toContain("mark:strike");
    expect(seen).not.toContain("mark:textStyle");
    expect(JSON.stringify(body)).toContain("Абзац текста");
    expect(materialBodySchema.safeParse(body).success).toBe(true);
  });

  it("048 EARS-2: when links and lists are pasted, the editor shall emit only allowlisted attributes and drop a forbidden link", async () => {
    const { surface, last } = setup();
    await waitFor(() => expect(surface()?.editor).toBeTruthy());
    act(() => {
      surface()!.editor!.view.pasteHTML(
        // A real paste event; jsdom has no ClipboardEvent constructor.
        '<h1>Заголовок</h1><h4>Мелкий</h4><p><a href="https://example.org/x" target="_top" class="c" title="t">внешняя</a> ' +
          '<a href="javascript:alert(1)">скрипт</a></p>' +
          '<ol start="0" type="a"><li>шаг</li></ol><blockquote><p>цитата</p></blockquote>',
        new Event("paste") as ClipboardEvent,
      );
    });
    const body = last()!;
    const parsed = materialBodySchema.safeParse(body);
    expect(parsed.success).toBe(true);
    const json = JSON.stringify(body);
    expect(json).toContain('"href":"https://example.org/x"');
    expect(json).not.toContain("javascript:");
    expect(json).not.toContain("_top");
    expect(json).toContain("скрипт");
  });

  it("048 EARS-2: the bold button marks the selection bold", async () => {
    const { surface, last } = setup({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "слово" }] },
      ],
    });
    await waitFor(() => expect(surface()?.editor).toBeTruthy());
    act(() => {
      surface()!.editor!.commands.selectAll();
    });
    fireEvent.click(
      screen.getByRole("button", { name: RICH_TEXT_EDITOR_COPY.bold }),
    );
    expect(types(last())).toContain("mark:bold");
    expect(materialBodySchema.safeParse(last()).success).toBe(true);
  });

  it("048 EARS-2: a link outside the allowed targets is refused in the link field", async () => {
    const { surface, last } = setup({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "слово" }] },
      ],
    });
    await waitFor(() => expect(surface()?.editor).toBeTruthy());
    act(() => {
      surface()!.editor!.commands.selectAll();
    });
    fireEvent.click(
      screen.getByRole("button", { name: RICH_TEXT_EDITOR_COPY.link }),
    );
    const field = screen.getByRole("textbox", {
      name: RICH_TEXT_EDITOR_COPY.linkField,
    });
    fireEvent.change(field, { target: { value: "javascript:alert(1)" } });
    fireEvent.click(
      screen.getByRole("button", { name: RICH_TEXT_EDITOR_COPY.linkApply }),
    );
    expect(screen.getByText(RICH_TEXT_EDITOR_COPY.linkInvalid)).toBeTruthy();
    expect(JSON.stringify(last() ?? {})).not.toContain("javascript:");
    fireEvent.change(field, {
      target: { value: "https://academy.doctor.school/" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: RICH_TEXT_EDITOR_COPY.linkApply }),
    );
    expect(types(last())).toContain("mark:link");
    expect(materialBodySchema.safeParse(last()).success).toBe(true);
  });
  it("048 EARS-2: the link chip opens the link field and reports it on aria-expanded, while mark toggles report aria-pressed", async () => {
    const { surface } = setup({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "слово" }] },
      ],
    });
    await waitFor(() => expect(surface()?.editor).toBeTruthy());
    const chip = screen.getByRole("button", {
      name: RICH_TEXT_EDITOR_COPY.link,
    });
    expect(chip.getAttribute("aria-pressed")).toBeNull();
    expect(chip.getAttribute("aria-expanded")).toBe("false");
    expect(
      screen
        .getByRole("button", { name: RICH_TEXT_EDITOR_COPY.bold })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-expanded")).toBe("true");
    const panel = document.getElementById(chip.getAttribute("aria-controls")!);
    expect(panel).toBeTruthy();
    expect(
      panel!.contains(
        screen.getByRole("textbox", { name: RICH_TEXT_EDITOR_COPY.linkField }),
      ),
    ).toBe(true);
  });
});
