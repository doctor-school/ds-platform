// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { EventListRouter, MAX_CURSOR_TRAIL } from "./event-list-router";

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
  upcoming: "Расписание",
  past: "Архив записей",
  emptyTitle: "Событий нет",
  pagination: "Страницы",
  previous: "Назад",
  next: "Вперёд",
  pagePrefix: "Страница",
};

function renderRouter({
  page = 1,
  cursor,
  nextCursor = "cursor-next",
  hasMore = true,
}: {
  page?: number;
  cursor?: string;
  nextCursor?: string | null;
  hasMore?: boolean;
} = {}) {
  return render(
    <EventListRouter
      items={[item]}
      selectedTab="past"
      counts={{ upcoming: 3, past: 12 }}
      labels={labels}
      cursor={cursor}
      nextCursor={nextCursor}
      hasMore={hasMore}
      page={page}
    />,
  );
}

/** The pushed query of the single `router.push` call. */
function pushedQuery() {
  expect(routerMock.push).toHaveBeenCalledTimes(1);
  const href = routerMock.push.mock.calls[0]![0] as string;
  return new URLSearchParams(href.split("?")[1] ?? "");
}

/**
 * #1641 — the webinar archive is a CURSOR feed: the API returns
 * `{ nextCursor, hasMore }` and nothing else, so a page count is unknowable. The
 * router used to fabricate one and render numbered pages of which only `page ± 1`
 * did anything — every other number was a dead click (012 EARS-23: no control that
 * cannot change state). The projection now drives the shared block's cursor mode.
 */
describe("<EventListRouter>", () => {
  it("#1641: renders only controls that move the feed — no numbered pages", () => {
    routerMock.searchParams = new URLSearchParams({
      tab: "past",
      cursor: "cursor-5",
      page: "5",
      cursorTrail: "cursor-2,cursor-3,cursor-4",
    });
    renderRouter({ page: 5, cursor: "cursor-5" });

    const controls = screen
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(controls).toContain("Назад");
    expect(controls).toContain("Вперёд");
    expect(controls).not.toContain("1");
    expect(screen.queryByRole("button", { name: "Страница 1" })).not.toBeInTheDocument();
  });

  it("#1641: the first page offers no previous control, and the last no next", () => {
    renderRouter({ page: 1 });
    expect(screen.queryByRole("button", { name: "Назад" })).not.toBeInTheDocument();

    cleanup();
    renderRouter({ page: 2, cursor: "cursor-2", nextCursor: null, hasMore: false });
    expect(screen.queryByRole("button", { name: "Вперёд" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Назад" })).toBeInTheDocument();
  });

  it("#1641: forward paging pushes the next cursor and remembers the current one", async () => {
    routerMock.searchParams = new URLSearchParams({ tab: "past", cursor: "cursor-2", page: "2" });
    renderRouter({ page: 2, cursor: "cursor-2" });

    await userEvent.click(screen.getByRole("button", { name: "Вперёд" }));

    const query = pushedQuery();
    expect(query.get("cursor")).toBe("cursor-next");
    expect(query.get("page")).toBe("3");
    expect(query.get("cursorTrail")).toBe("cursor-2");
    expect(query.get("tab")).toBe("past");
  });

  it("#1641: back paging pops the trail, and page two returns to the un-cursored first page", async () => {
    routerMock.searchParams = new URLSearchParams({
      tab: "past",
      cursor: "cursor-3",
      page: "3",
      cursorTrail: "cursor-2",
    });
    renderRouter({ page: 3, cursor: "cursor-3" });

    await userEvent.click(screen.getByRole("button", { name: "Назад" }));

    const query = pushedQuery();
    expect(query.get("cursor")).toBe("cursor-2");
    expect(query.get("page")).toBe("2");
    expect(query.get("cursorTrail")).toBeNull();

    cleanup();
    routerMock.push.mockReset();
    routerMock.searchParams = new URLSearchParams({ tab: "past", cursor: "cursor-2", page: "2" });
    renderRouter({ page: 2, cursor: "cursor-2" });

    await userEvent.click(screen.getByRole("button", { name: "Назад" }));

    const firstPage = pushedQuery();
    expect(firstPage.get("cursor")).toBeNull();
    expect(firstPage.get("page")).toBeNull();
    expect(firstPage.get("cursorTrail")).toBeNull();
    expect(firstPage.get("tab")).toBe("past");
  });

  it("#1641: the trail is bounded — deep paging drops the oldest cursors, never the URL", async () => {
    const trail = Array.from(
      { length: MAX_CURSOR_TRAIL },
      (_, index) => `cursor-${index + 2}`,
    );
    routerMock.searchParams = new URLSearchParams({
      tab: "past",
      cursor: "cursor-deep",
      page: String(MAX_CURSOR_TRAIL + 2),
      cursorTrail: trail.join(","),
    });
    renderRouter({ page: MAX_CURSOR_TRAIL + 2, cursor: "cursor-deep" });

    await userEvent.click(screen.getByRole("button", { name: "Вперёд" }));

    const pushed = pushedQuery().get("cursorTrail")!.split(",");
    expect(pushed).toHaveLength(MAX_CURSOR_TRAIL);
    // The oldest entry is dropped; the cursor Prev needs next is the newest one.
    expect(pushed).not.toContain(trail[0]);
    expect(pushed.at(-1)).toBe("cursor-deep");
  });

  it("#1641: no previous control once the bounded trail can no longer serve one", () => {
    routerMock.searchParams = new URLSearchParams({
      tab: "past",
      cursor: "cursor-far",
      page: "40",
    });
    renderRouter({ page: 40, cursor: "cursor-far" });

    expect(screen.queryByRole("button", { name: "Назад" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Вперёд" })).toBeInTheDocument();
  });
});
