import * as React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import {
  DoctorContentCard,
  type DoctorContentCardProps,
  type DoctorContentCardState,
} from "./content-card";

/**
 * 018 EARS-2 (#1497) — the doctor content card as ONE `@ds/design-system` unit,
 * Stage-A variant «Б — типографская» (`design-source/unit-content-card.dc.html`).
 * Scenarios: `018-scenarios.feature` «The doctor content card renders every state
 * from one unit» — every state shows the kicker, the title, the metadata and the
 * counter, and the unit exposes no cover-image slot.
 */

const base: DoctorContentCardProps = {
  kind: "course",
  kicker: "Курс-сериал",
  title: "Ортобиология в практике травматолога",
  meta: { value: "9", label: "серий" },
  counter: "Уже записались 37 ортопедов",
  state: "normal",
  href: "/courses/ortobiologiya",
};

function renderCard(props: Partial<DoctorContentCardProps> = {}) {
  render(<DoctorContentCard {...base} {...props} />);
  const link = screen.getByRole("link", { name: base.title });
  const card = link.closest("[data-content-card]") as HTMLElement;
  return { link, card };
}

afterEach(cleanup);

describe("DoctorContentCard", () => {
  const states: DoctorContentCardState[] = [
    "normal",
    "started",
    "completed",
    "gate",
    "soon",
  ];

  it.each(states)(
    "018 EARS-2: renders the kicker, title, metadata and counter in state %s",
    (state) => {
      const { card } = renderCard({ state, progress: 40 });
      expect(card).toHaveAttribute("data-state", state);
      const scope = within(card);
      expect(scope.getByText("Курс-сериал")).toBeInTheDocument();
      expect(scope.getByText(base.title)).toBeInTheDocument();
      expect(scope.getByText("9")).toBeInTheDocument();
      expect(scope.getByText("серий")).toBeInTheDocument();
      expect(
        scope.getByText("Уже записались 37 ортопедов"),
      ).toBeInTheDocument();
    },
  );

  it("018 EARS-2: exposes exactly one link, to href, named by the title", () => {
    const { card, link } = renderCard();
    expect(within(card).getAllByRole("link")).toHaveLength(1);
    expect(link).toHaveAttribute("href", base.href);
  });

  it("018 EARS-2: the link is keyboard-reachable (focus state)", async () => {
    const { link } = renderCard();
    await userEvent.tab();
    expect(link).toHaveFocus();
    // The focus ring rides the stretched link overlay, hover lifts the root.
    expect(link.className).toContain("focus-visible:after:shadow-focus");
  });

  it("018 EARS-2: hover is a presentation state of the root, not a prop value", () => {
    const { card } = renderCard();
    expect(card.className).toContain("layout:hover:shadow-md");
    cleanup();
    const soon = renderCard({ state: "soon" }).card;
    // «Скоро» does not lift: the canvas drops the hover translate for it.
    expect(soon.className).not.toContain("layout:hover:shadow-md");
  });

  it("018 EARS-2: normal shows the «Открыть →» call to action", () => {
    const { card } = renderCard();
    expect(within(card).getByText("Открыть →")).toBeInTheDocument();
  });

  it("018 EARS-2: started shows the progress bar with its clamped value and «Продолжить →»", () => {
    const { card } = renderCard({ state: "started", progress: 33 });
    const bar = within(card).getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "33");
    expect(within(card).getByText("Вы прошли 33%")).toBeInTheDocument();
    expect(within(card).getByText("Продолжить →")).toBeInTheDocument();
    cleanup();
    const over = renderCard({ state: "started", progress: 140 }).card;
    expect(within(over).getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
  });

  it("018 EARS-2: progress is shown only in the started state", () => {
    const { card } = renderCard({ state: "normal", progress: 50 });
    expect(within(card).queryByRole("progressbar")).toBeNull();
  });

  it("018 EARS-2: completed shows «✓ Завершено» and «Открыть снова →»", () => {
    const { card } = renderCard({ state: "completed" });
    expect(within(card).getByText("✓ Завершено")).toBeInTheDocument();
    expect(within(card).getByText("Открыть снова →")).toBeInTheDocument();
  });

  it("018 EARS-2: gate shows the registration footer instead of a call to action", () => {
    const { card, link } = renderCard({ state: "gate" });
    expect(
      within(card).getByText("Смотреть — нужна регистрация →"),
    ).toBeInTheDocument();
    expect(within(card).queryByText("Открыть →")).toBeNull();
    // The gate is announced with the one link, not as a second link.
    expect(link).toHaveAccessibleDescription(/нужна регистрация/);
  });

  it("018 EARS-2: soon shows the «Скоро» mark, a dashed frame and no call to action", () => {
    const { card } = renderCard({ state: "soon" });
    expect(within(card).getByText("Скоро")).toBeInTheDocument();
    expect(card.className).toContain("layout:border-dashed");
    expect(within(card).queryByText("Открыть →")).toBeNull();
  });

  it("018 EARS-2: omits the counter when none is passed instead of showing zero", () => {
    const { card } = renderCard({ counter: undefined });
    expect(within(card).queryByText(/записались/)).toBeNull();
  });

  it("018 EARS-2: exposes no cover-image slot", () => {
    const { card } = renderCard({
      // A cover prop has no place in the contract — it must not type-check …
      // @ts-expect-error — `cover` is not a DoctorContentCard prop.
      cover: "/cover.png",
    });
    // … and nothing image-like reaches the DOM.
    expect(card.querySelector("img, picture, [role='img']")).toBeNull();
    expect(card).not.toHaveAttribute("cover");
  });
});
