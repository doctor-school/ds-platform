import { render, screen, cleanup, act } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RecordingSpoiler } from "./recording-spoiler";

afterEach(cleanup);

/**
 * 014 EARS-8 — the «Смотреть оригинал трансляции» spoiler (source
 * `design-source/webinar-archive.dc.html` L165-179, the `showSpoiler` unit).
 * The block is the SECONDARY-cut disclosure that sits under the main player
 * when an event published both an edited and a raw cut.
 *
 * Three things the host cannot see from a type signature, so they are pinned
 * here:
 *   • the control is a NATIVE `<summary>` inside `<details>` — keyboard
 *     operation and the expanded/collapsed a11y state come from the platform,
 *     not from a hand-rolled button + `aria-expanded` pair;
 *   • the body is NOT in the DOM while collapsed. A `<details>` keeps hidden
 *     children mounted, which for this block would mean a provider iframe
 *     fetching a recording nobody asked to watch — so the block renders the
 *     body only while open;
 *   • the hint is hide-until-content: omitted ⇒ no empty line under the label.
 *
 * All copy is injected — the host resolves it through the message catalog.
 */
const LABELS = {
  summaryLabel: "Смотреть оригинал трансляции",
  hint: "без монтажа, с паузами и вопросами между блоками",
};

function body() {
  return <p data-testid="spoiler-body">оригинал</p>;
}

describe("014 EARS-8 RecordingSpoiler — collapsed by default", () => {
  it("EARS-8: when both cuts are published, the system shall offer a labelled disclosure control", () => {
    render(<RecordingSpoiler {...LABELS}>{body()}</RecordingSpoiler>);
    const label = screen.getByText(LABELS.summaryLabel);
    expect(label.closest("summary")).not.toBeNull();
    expect(screen.getByText(LABELS.hint)).toBeInTheDocument();
  });

  it("EARS-8: when the disclosure is collapsed, the system shall keep the secondary body out of the DOM", () => {
    const { container } = render(
      <RecordingSpoiler {...LABELS}>{body()}</RecordingSpoiler>,
    );
    expect(container.querySelector("details")?.open).toBe(false);
    expect(screen.queryByTestId("spoiler-body")).toBeNull();
  });

  it("EARS-8: when the host passes a test id, the system shall forward it to the disclosure root", () => {
    render(
      <RecordingSpoiler {...LABELS} data-testid="recording-spoiler">
        {body()}
      </RecordingSpoiler>,
    );
    expect(screen.getByTestId("recording-spoiler").tagName).toBe("DETAILS");
  });
});

describe("014 EARS-8 RecordingSpoiler — opened", () => {
  /**
   * jsdom fires `toggle` from a macrotask queued when the `open` attribute
   * changes, exactly as the spec requires of a real browser. Flushing that tick
   * is what drives the NATIVE toggle path through the component instead of a
   * synthesised React event — and it also lands the timer before unmount, which
   * the #441 orphan-timer guard requires.
   */
  async function flushNativeToggle() {
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
  }

  it("EARS-8: when the disclosure is opened, the system shall mount the secondary body", async () => {
    const { container } = render(
      <RecordingSpoiler {...LABELS}>{body()}</RecordingSpoiler>,
    );
    const details = container.querySelector("details")!;
    expect(screen.queryByTestId("spoiler-body")).toBeNull();

    details.open = true;
    await flushNativeToggle();

    expect(screen.getByTestId("spoiler-body")).toBeInTheDocument();
  });

  it("EARS-8: when the host asks for it open, the system shall render expanded with its body mounted", async () => {
    const { container } = render(
      <RecordingSpoiler {...LABELS} defaultOpen>
        {body()}
      </RecordingSpoiler>,
    );
    await flushNativeToggle();
    expect(container.querySelector("details")?.open).toBe(true);
    expect(screen.getByTestId("spoiler-body")).toBeInTheDocument();
  });
});

describe("014 EARS-8 RecordingSpoiler — hide-until-content", () => {
  it("EARS-8: when no hint is supplied, the system shall render no hint line at all", () => {
    render(
      <RecordingSpoiler summaryLabel={LABELS.summaryLabel}>
        {body()}
      </RecordingSpoiler>,
    );
    expect(screen.queryByText(LABELS.hint)).toBeNull();
    expect(screen.getByText(LABELS.summaryLabel)).toBeInTheDocument();
  });
});
