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
    await userEvent.click(screen.getByRole("tab", { name: "Прошедшие · 2" }));
    await userEvent.click(screen.getByRole("button", { name: "Вперёд" }));
    expect(onTabChange).toHaveBeenCalledWith("past");
    expect(onPageChange).toHaveBeenCalledWith(2, "opaque-current");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("EARS-11: archive mode keeps the canvas tabs ahead of a month-grouped feed", () => {
    const archiveItem = {
      ...item,
      groupKey: "2026-08",
      groupLabel: "Август 2026",
      recordingLabel: "Запись готовится",
      ctaHref: item.href,
      ctaLabel: "Смотреть запись ↗",
      variant: "past" as const,
    };

    const { container } = render(
      <EventList
        items={[archiveItem]}
        selectedTab="past"
        onTabChange={vi.fn()}
        counts={{ upcoming: 3, past: 2 }}
        labels={{
          upcoming: "Расписание",
          past: "Архив записей",
          emptyTitle: "Событий нет",
          pagination: "Страницы",
          previous: "Назад",
          next: "Вперёд",
          page: (page) => `Страница ${page}`,
        }}
        page={1}
        pageCount={1}
        onPageChange={vi.fn()}
      />,
    );

    const tabs = container.querySelector("[data-event-list-tabs]");
    const body = container.querySelector("[data-event-list-body]");
    expect(tabs).not.toBeNull();
    expect(body).not.toBeNull();
    expect(
      tabs!.compareDocumentPosition(body!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getAllByText("Август 2026")).toHaveLength(2);
    expect(
      screen.getByRole("tab", { name: "Расписание · 3" }).className,
    ).toContain("active:bg-primary-pressed");
    expect(
      screen.getByRole("link", { name: "Смотреть запись ↗" }),
    ).toHaveAttribute("href", item.href);
    expect(screen.getByText("Запись готовится")).toBeInTheDocument();
  });

  it("#1641: a cursor-paged host gets prev/next only — never a fabricated page count", async () => {
    const onPageChange = vi.fn();

    render(
      <EventList
        items={[item]}
        selectedTab="past"
        onTabChange={vi.fn()}
        counts={{ upcoming: 3, past: 2 }}
        labels={{
          upcoming: "Расписание",
          past: "Архив записей",
          emptyTitle: "Событий нет",
          pagination: "Страницы",
          previous: "Назад",
          next: "Вперёд",
          page: (page) => `Страница ${page}`,
        }}
        paginationMode="cursor"
        page={3}
        hasPrevious
        hasNext
        cursor="opaque-current"
        onPageChange={onPageChange}
      />,
    );

    expect(
      screen
        .getAllByRole("button")
        .map((button) => button.textContent)
        .filter((text) => text === "Назад" || text === "Вперёд"),
    ).toEqual(["Назад", "Вперёд"]);
    expect(
      screen.queryByRole("button", { name: "Страница 1" }),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Вперёд" }));
    expect(onPageChange).toHaveBeenCalledWith(4, "opaque-current");
  });
  it("019 EARS-3: the day plates of «Будущие» stick under the default zero offset on the page-background surface", () => {
    const { container } = render(
      <EventList
        items={[item, { ...item, id: "event-2", groupKey: "2026-08-30", groupLabel: "30 августа, воскресенье" }]}
        selectedTab="upcoming"
        tenseControl="none"
        paginationMode="none"
        labels={{ emptyTitle: "Событий нет" }}
      />,
    );

    const headers = container.querySelectorAll<HTMLElement>(
      "section > [data-event-list-group-header]",
    );
    expect(headers).toHaveLength(2);
    for (const header of headers) {
      expect(header.className).toContain("sticky");
      expect(header.className).toContain("z-10");
      expect(header.className).toContain("bg-background");
      expect(header.style.top).toBe("0px");
      // On desktop the opaque plate reaches over the cards' 6px `shadow-lg`
      // cast, so a scrolled card's right edge never pokes up beside it.
      expect(header.className).toContain("layout:-mr-1.5");
      expect(header.className).toContain("layout:pr-1.5");
      // The header is the section's first child: it sticks only while its own group scrolls.
      expect(header.parentElement!.firstElementChild).toBe(header);
    }
    expect(headers[0]!.textContent).toContain("29 августа, суббота");
  });

  it("019 EARS-3: the month plates of «Прошедшие» stick under the storefront header offset a host passes", () => {
    const { container } = render(
      <EventList
        items={[{ ...item, groupKey: "2026-08", groupLabel: "Август 2026", variant: "past" as const }]}
        selectedTab="past"
        onTabChange={vi.fn()}
        counts={{ upcoming: 0, past: 1 }}
        labels={{ upcoming: "Будущие", past: "Прошедшие", emptyTitle: "Событий нет" }}
        paginationMode="none"
        stickyHeaderOffset={64}
      />,
    );

    const header = container.querySelector<HTMLElement>(
      "[data-event-list-body] section > [data-event-list-group-header]",
    );
    expect(header).not.toBeNull();
    expect(header!.className).toContain("sticky");
    expect(header!.style.top).toBe("64px");
    expect(header!.textContent).toContain("Август 2026");
  });
});
