import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMonthBroadcasts, fetchMonthlyCounts } = vi.hoisted(() => ({
  fetchMonthBroadcasts: vi.fn(),
  fetchMonthlyCounts: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string, values?: Record<string, unknown>) =>
    values?.count === undefined ? key : `${key}:${String(values.count)}`),
}));

vi.mock("@/lib/public-events", () => ({
  fetchMonthBroadcasts,
  fetchMonthlyCounts,
}));

vi.mock("@ds/design-system/blocks", async (importOriginal) => {
  const original = await importOriginal<typeof import("@ds/design-system/blocks")>();
  return { ...original, MonthPicker: () => null };
});

vi.mock("./calendar-shell", () => ({
  CalendarShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("./month-calendar-mobile", () => ({
  MonthCalendarMobile: () => null,
}));

vi.mock("./view-switcher", () => ({
  ViewSwitcher: () => null,
}));

import { MonthCalendarView } from "./month-calendar-view";

describe("<MonthCalendarView>", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-30T12:00:00.000Z"));
    fetchMonthlyCounts.mockResolvedValue([]);
    fetchMonthBroadcasts.mockResolvedValue([
      {
        id: "11111111-1111-4111-8111-111111111111",
        slug: "diabet-i-komorbidnost",
        title: "Итоги: диабет и коморбидность",
        school: "Школа эндокринологии",
        startsAt: "2026-07-09T16:00:00.000Z",
        state: "ended",
      },
    ]);
  });

  afterEach(() => vi.useRealTimers());

  it("EARS-11: desktop month keeps every past event titled and linked instead of collapsing it to an aggregate note", async () => {
    render(await MonthCalendarView({ month: "2026-07" }));

    const desktop = screen.getByTestId("month-grid-desktop");
    const event = within(desktop).getByRole("link", {
      name: /19:00 · Итоги: диабет и коморбидность/,
    });

    expect(event).toHaveAttribute("href", "/webinars/diabet-i-komorbidnost");
    expect(within(desktop).queryByText("pastNote:1")).not.toBeInTheDocument();
  });
});
