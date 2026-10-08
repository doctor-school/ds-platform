// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { EventListRouter } from "./event-list-router";

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerMock.push }),
  useSearchParams: () => routerMock.searchParams,
}));

afterEach(cleanup);
beforeEach(() => {
  routerMock.push.mockReset();
  routerMock.searchParams = new URLSearchParams();
});

const item = {
  id: "event-1",
  groupKey: "2026-08",
  groupLabel: "Август 2026",
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

const labels = {
  upcoming: "Предстоящие",
  past: "Записи",
  emptyTitle: "Событий нет",
};

function renderRouter(selectedTab: "upcoming" | "past" = "upcoming") {
  return render(
    <EventListRouter
      basePath="/account/events"
      pastTabParam="recordings"
      items={[item]}
      selectedTab={selectedTab}
      counts={{ upcoming: 3, past: 12 }}
      labels={labels}
    />,
  );
}

// 014 EARS-9 — gate rows 25–26 / 32: the «Мои события» tabs are URL state on
// the host's route; the whole tab is one read, so nothing pages (D2 removed the
// cursor paging from the package).
describe("<EventListRouter>", () => {
  it("014 EARS-9: a tab writes the host's tab param on the host's route and keeps the rest of the query", async () => {
    routerMock.searchParams = new URLSearchParams("utm=x");
    renderRouter("upcoming");
    await userEvent.click(screen.getByRole("tab", { name: /Записи/ }));
    expect(routerMock.push).toHaveBeenCalledWith(
      "/account/events?utm=x&tab=recordings",
    );
  });

  it("014 EARS-9: «Предстоящие» is the default tab and carries no param", async () => {
    routerMock.searchParams = new URLSearchParams("tab=recordings");
    renderRouter("past");
    await userEvent.click(screen.getByRole("tab", { name: /Предстоящие/ }));
    expect(routerMock.push).toHaveBeenCalledWith("/account/events");
  });

  it("NEW: no paging control renders — the whole tab is one read", () => {
    renderRouter();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("button", { name: /Назад|Вперёд/ })).toBeNull();
  });
});
