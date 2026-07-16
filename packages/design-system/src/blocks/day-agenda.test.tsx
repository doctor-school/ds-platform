import { render, screen, cleanup, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DayAgenda } from "./day-agenda";

afterEach(cleanup);

/**
 * `<DayAgenda>` (004 EARS-19) — the selected-day event list. Presentation-only;
 * the harness asserts each row links to its event page, a live row shows the
 * app-supplied «LIVE» badge (text, not colour-only), and an empty day renders the
 * app-chosen note instead of rows.
 */
describe("<DayAgenda>", () => {
  it("renders rows linking to the event page, with a live badge on a live row", () => {
    render(
      <DayAgenda
        title="7 июля, вторник · сегодня"
        emptyText="В этот день эфиров нет"
        rows={[
          {
            href: "/webinars/l",
            time: "19:00",
            school: "Школа кардиологии",
            title: "Прямой эфир",
            live: true,
            liveLabel: "LIVE",
          },
        ]}
      />,
    );
    const link = screen.getByRole("link", { name: /Прямой эфир/ });
    expect(link).toHaveAttribute("href", "/webinars/l");
    expect(within(link).getByText("LIVE")).toBeInTheDocument();
    expect(within(link).getByText("19:00")).toBeInTheDocument();
  });

  it("renders the empty note when the day has no events", () => {
    render(
      <DayAgenda title="9 июля, четверг" rows={[]} emptyText="В этот день эфиров нет" />,
    );
    expect(screen.getByText("В этот день эфиров нет")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
