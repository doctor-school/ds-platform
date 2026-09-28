import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./sheet";

/**
 * #2396 — the side-panel record inspector (owner decision on #2377: the record
 * opens on the right OVER the roster, the roster stays visible, ↑/↓ walk the
 * records, Esc closes; the desk entry form lives in the same panel).
 *
 * Modality is breakpoint-owned by the primitive: at ≥ lg (64rem) the sheet is a
 * non-modal inspector beside a live page; below lg it is a modal full cover.
 * jsdom has no layout, so the breakpoint is driven through a matchMedia stub.
 */
let desktop = true;
beforeEach(() => {
  desktop = true;
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: desktop,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});
afterEach(cleanup);

type FixtureProps = {
  onNavigate?: (direction: "prev" | "next") => void;
  side?: "right" | "left";
  size?: "md" | "lg";
};

function RecordFixture({ onNavigate, side, size }: FixtureProps) {
  return (
    <div>
      <button type="button">Строка реестра</button>
      <Sheet>
        <SheetTrigger>Открыть запись</SheetTrigger>
        <SheetContent
          side={side}
          size={size}
          onNavigate={onNavigate}
          data-testid="sheet"
        >
          <SheetHeader>
            <SheetTitle>Иванова Мария</SheetTitle>
            <SheetDescription>Участник конгресса</SheetDescription>
          </SheetHeader>
          <SheetBody data-testid="sheet-body">
            <label>
              Комментарий
              <input aria-label="Комментарий" />
            </label>
          </SheetBody>
          <SheetFooter>
            <SheetClose>Отмена</SheetClose>
            <button type="button">Сохранить</button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

async function openSheet(props: FixtureProps = {}) {
  const user = userEvent.setup();
  render(<RecordFixture {...props} />);
  await user.click(screen.getByText("Открыть запись"));
  const sheet = await screen.findByRole("dialog");
  return { user, sheet };
}

/** Close and let Radix's focus-restore timer run inside the test (#441 guard). */
async function dismiss(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
}

describe("#2396 Sheet — open / close", () => {
  it("opens named and described by its own title and description", async () => {
    const { user, sheet } = await openSheet();
    expect(sheet).toHaveAccessibleName("Иванова Мария");
    expect(sheet).toHaveAccessibleDescription("Участник конгресса");
    await dismiss(user);
  });

  it("closes on Escape", async () => {
    const { user } = await openSheet();
    await dismiss(user);
  });

  it("closes from SheetClose and from the named × affordance", async () => {
    const { user } = await openSheet();
    await user.click(screen.getByText("Отмена"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    await user.click(screen.getByText("Открыть запись"));
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Закрыть" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("scrolls only the body — header and footer stay put", async () => {
    const { user, sheet } = await openSheet();
    expect(screen.getByTestId("sheet-body").className).toMatch(
      /overflow-y-auto/,
    );
    expect(sheet.className).not.toMatch(/overflow-y-auto/);
    await dismiss(user);
  });
});

describe("#2396 Sheet — modality follows the lg breakpoint", () => {
  it("at ≥ lg is a non-modal inspector: no aria-modal, no scrim, the page behind stays live", async () => {
    const { user, sheet } = await openSheet();
    expect(sheet).not.toHaveAttribute("aria-modal");
    expect(sheet).toHaveAttribute("data-modal", "false");
    expect(document.querySelector("[data-sheet-overlay]")).toBeNull();

    // The roster is still in the accessibility tree and still clickable.
    const row = screen.getByRole("button", { name: "Строка реестра" });
    expect(row.closest("[aria-hidden='true']")).toBeNull();
    await user.click(row);
    // Choosing another roster row must not dismiss the inspector.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await dismiss(user);
  });

  it("below lg is a modal full cover: aria-modal, a scrim, the page behind hidden", async () => {
    desktop = false;
    const { user, sheet } = await openSheet();
    expect(sheet).toHaveAttribute("aria-modal", "true");
    expect(sheet).toHaveAttribute("data-modal", "true");
    expect(document.querySelector("[data-sheet-overlay]")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Строка реестра" })).toBeNull();
    await dismiss(user);
  });

  it("below lg traps focus inside the sheet", async () => {
    desktop = false;
    const { user, sheet } = await openSheet();
    for (let i = 0; i < 8; i += 1) {
      await user.tab();
      expect(sheet.contains(document.activeElement)).toBe(true);
    }
    await dismiss(user);
  });
});

describe("#2396 Sheet — ↑/↓ walk the records", () => {
  it("fires onNavigate prev/next when the sheet container holds focus", async () => {
    const onNavigate = vi.fn();
    const { user, sheet } = await openSheet({ onNavigate });
    sheet.focus();
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowUp}");
    expect(onNavigate.mock.calls).toEqual([["next"], ["prev"]]);
    await dismiss(user);
  });

  it("fires from a non-editable control inside the sheet (a button)", async () => {
    const onNavigate = vi.fn();
    const { user } = await openSheet({ onNavigate });
    screen.getByRole("button", { name: "Сохранить" }).focus();
    await user.keyboard("{ArrowDown}");
    expect(onNavigate).toHaveBeenCalledWith("next");
    await dismiss(user);
  });

  it("does NOT fire while focus is in a form field — the field keeps its arrows", async () => {
    const onNavigate = vi.fn();
    const { user } = await openSheet({ onNavigate });
    screen.getByLabelText("Комментарий").focus();
    await user.keyboard("{ArrowDown}{ArrowUp}");
    expect(onNavigate).not.toHaveBeenCalled();
    await dismiss(user);
  });

  it("does NOT fire with a modifier held", async () => {
    const onNavigate = vi.fn();
    const { user, sheet } = await openSheet({ onNavigate });
    sheet.focus();
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect(onNavigate).not.toHaveBeenCalled();
    await dismiss(user);
  });
});

describe("#2396 Sheet — motion and variants", () => {
  it("slides in on data-state=open and drops the transition under motion-reduce", async () => {
    const { user, sheet } = await openSheet();
    expect(sheet).toHaveAttribute("data-state", "open");
    expect(sheet.className).toMatch(/transition-transform/);
    expect(sheet.className).toMatch(
      /data-\[state=open\]:starting:translate-x-full/,
    );
    expect(sheet.className).toMatch(/motion-reduce:transition-none/);
    await dismiss(user);
  });

  it("defaults to side=right size=md", async () => {
    const { user, sheet } = await openSheet();
    expect(sheet).toHaveAttribute("data-side", "right");
    expect(sheet).toHaveAttribute("data-size", "md");
    expect(sheet.className).toMatch(/right-0/);
    expect(sheet.className).toMatch(/lg:w-1\/3/);
    expect(sheet.className).toMatch(/lg:min-w-90/);
    await dismiss(user);
  });

  it("side=left size=lg mirror the edge and widen the panel", async () => {
    const { user, sheet } = await openSheet({ side: "left", size: "lg" });
    expect(sheet).toHaveAttribute("data-side", "left");
    expect(sheet).toHaveAttribute("data-size", "lg");
    expect(sheet.className).toMatch(/left-0/);
    expect(sheet.className).toMatch(
      /data-\[state=open\]:starting:-translate-x-full/,
    );
    expect(sheet.className).toMatch(/lg:w-1\/2/);
    await dismiss(user);
  });
});
