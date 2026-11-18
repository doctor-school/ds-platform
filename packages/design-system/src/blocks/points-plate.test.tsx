// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PointsPlate } from "./points-plate";

// 025 points plate — the «Очки внимания» unit of design-source/doctor-lesson.dc.html
// §4 (anatomy) mounted by the 024 course path and step screen: the three
// balances from the one ledger read, a dash for a guest, optional footer links
// absent rather than dead.

describe("PointsPlate", () => {
  it("shows the three balances with their unit, name and caption, grouped in Russian", () => {
    render(<PointsPlate balances={{ pul: 1250, bre: 34, con: 0 }} />);
    expect(
      screen.getByRole("heading", { level: 2, name: "Очки внимания" }),
    ).toBeInTheDocument();
    const cols = screen.getAllByTestId("points-plate-kind");
    expect(cols).toHaveLength(3);
    expect(cols[0]).toHaveTextContent(/^1\s250 PulПульс/);
    expect(cols[1]).toHaveTextContent(/^34 BreДыхание/);
    expect(cols[2]).toHaveTextContent(/^0 ConСознание/);
    expect(
      within(cols[2]!).getByText(
        "Итог пути: начисляется за завершённые шаги и только растёт.",
      ),
    ).toBeInTheDocument();
  });

  it("shows a dash for every balance when there is no account (a guest)", () => {
    render(<PointsPlate balances={null} />);
    const values = screen
      .getAllByTestId("points-plate-value")
      .map((v) => v.textContent);
    expect(values).toEqual(["— Pul", "— Bre", "— Con"]);
  });

  it("renders no footer without a history link or a footnote, and the link when given", () => {
    const { rerender } = render(<PointsPlate balances={null} />);
    expect(screen.queryByTestId("points-plate-footer")).toBeNull();
    rerender(<PointsPlate balances={null} historyHref="/points" />);
    expect(
      screen.getByRole("link", { name: "История начислений" }),
    ).toHaveAttribute("href", "/points");
  });
});
