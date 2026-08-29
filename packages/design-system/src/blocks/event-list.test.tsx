import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EventList } from "./event-list";

afterEach(cleanup);

const item = {
  id: "event-1",
  groupKey: "2026-08-29",
  groupLabel: "29 августа, суббота",
  href: "/webinars/event-1",
  time: "19:00",
  tzLabel: "МСК",
  dateLabel: "29 августа · сб",
  school: "Школа кардиологии",
  title: "Клинический разбор",
  specialties: ["Кардиология"],
  speakers: [{ name: "Доктор" }],
  recordingLabel: "Запись эфира",
};

describe("<EventList>", () => {
  it("EARS-10: when a host injects listing state, the shared unit shall stay controlled and fetch-free", async () => {
    const onTabChange = vi.fn();
    const onPageChange = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    render(
      <EventList
        items={[item]}
        selectedTab="upcoming"
        onTabChange={onTabChange}
        counts={{ upcoming: 3, past: 2 }}
        labels={{
          upcoming: "Предстоящие",
          past: "Прошедшие",
          emptyTitle: "Событий нет",
          pagination: "Страницы",
          previous: "Назад",
          next: "Вперёд",
          page: (page) => `Страница ${page}`,
        }}
        page={1}
        pageCount={2}
        cursor="opaque-current"
        onPageChange={onPageChange}
      />,
    );

    expect(
      screen.getByRole("tab", { name: "Предстоящие · 3" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("link", { name: "Клинический разбор" }),
    ).toHaveAttribute("href", "/webinars/event-1");
    expect(screen.getByText("Запись эфира")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Прошедшие · 2" }));
    await userEvent.click(screen.getByRole("button", { name: "Вперёд" }));
    expect(onTabChange).toHaveBeenCalledWith("past");
    expect(onPageChange).toHaveBeenCalledWith(2, "opaque-current");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
