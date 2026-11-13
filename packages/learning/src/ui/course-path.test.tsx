// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CoursePath } from "./course-path";
import { summaryAction } from "./node-summary";
import { buildPathView } from "./path-view";
import { CONFIG, ID, coursePath, lessonRead, stubFetch, stubMatchMedia } from "./__tests__/fixtures";

// 024 EARS-14 — the course path block of `design-source/doctor-course.dc.html`
// v16: node states, the locked reason, the empty and error states, the
// breadcrumb, the author, and the summary of the selected node.

const node = (name: RegExp) => screen.getByRole("button", { name });

describe("024 EARS-14 — the course path", () => {
  beforeEach(() => {
    stubMatchMedia(false);
    stubFetch({ [`GET /v1/learning/lessons/${ID.l2}`]: lessonRead() });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("EARS-14: every node names its state — done, «Вы здесь», open and locked with its reason", () => {
    render(<CoursePath courseSlug="kardio" config={CONFIG} initial={coursePath()} />);
    expect(node(/Урок 1, шаг 1\. Серия\. Сбор анамнеза\. Пройден/)).toBeInTheDocument();
    expect(node(/Урок 2, шаг 1\. Серия\. Чтение ЭКГ\. Вы здесь/)).toBeInTheDocument();
    expect(node(/Урок 2, шаг 2\. Материал для скачивания\. Памятка по ЭКГ\. Открыт/)).toBeInTheDocument();
    expect(node(/Урок 3, шаг 1\. Тест\. Итоговый тест\. Закрыт/)).toBeInTheDocument();
    expect(screen.getAllByText("Вы здесь", { selector: "span,div" }).length).toBeGreaterThan(0);
    expect(screen.getByText("Шаг откроется, когда будут пройдены предыдущие.")).toBeInTheDocument();
  });

  it("EARS-14: the progress band counts done lessons from the read and continues at the «Вы здесь» step", () => {
    render(<CoursePath courseSlug="kardio" config={CONFIG} initial={coursePath()} />);
    expect(screen.getAllByText("Пройдено 1 урок из 3").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Продолжить — урок 2" })).toHaveAttribute(
      "href",
      `/courses/kardio/steps/${ID.s2}`,
    );
  });

  it("EARS-14: a course with no lessons shows the empty state, not an empty snake", () => {
    render(<CoursePath courseSlug="kardio" config={CONFIG} initial={coursePath({ modules: [], current: null })} />);
    expect(screen.getByText("Путь готовится.")).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /Урок \d/ })).toHaveLength(0);
  });

  it("EARS-14: a failed read shows the error and «Повторить» reads the path again", async () => {
    const fetch = stubFetch({ "GET /v1/learning/courses/kardio/path": coursePath() });
    render(<CoursePath courseSlug="kardio" config={CONFIG} initial={null} />);
    expect(screen.getByText("Не удалось загрузить путь курса.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(node(/Чтение ЭКГ\. Вы здесь/)).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith("/v1/learning/courses/kardio/path", expect.objectContaining({ method: "GET" }));
  });

  it("EARS-14: the breadcrumb names direction, school and course from the read, and omits a non-public direction", () => {
    const { unmount } = render(<CoursePath courseSlug="kardio" config={CONFIG} initial={coursePath()} />);
    const crumbs = within(screen.getByRole("navigation", { name: "Вы здесь" }));
    expect(crumbs.getByText("Кардиология")).toBeInTheDocument();
    expect(crumbs.getByText("Школа сердца")).toBeInTheDocument();
    expect(crumbs.getByText("Кардиология для практика")).toHaveAttribute("aria-current", "page");
    unmount();
    render(<CoursePath courseSlug="kardio" config={CONFIG} initial={coursePath({ direction: null })} />);
    const none = within(screen.getByRole("navigation", { name: "Вы здесь" }));
    expect(none.queryByText("Кардиология")).toBeNull();
    expect(none.getByText("Школа сердца")).toBeInTheDocument();
  });

  it("EARS-14: the author block shows a public author and is absent without one", () => {
    const { unmount } = render(<CoursePath courseSlug="kardio" config={CONFIG} initial={coursePath()} />);
    expect(screen.getByText("Автор курса")).toBeInTheDocument();
    expect(screen.getByText("Анна Иванова")).toBeInTheDocument();
    unmount();
    render(<CoursePath courseSlug="kardio" config={CONFIG} initial={coursePath({ author: null })} />);
    expect(screen.queryByText("Автор курса")).toBeNull();
  });

  it("EARS-14: selecting a node shows its summary with the lesson's sentence and the one action its state allows", async () => {
    render(<CoursePath courseSlug="kardio" config={CONFIG} initial={coursePath()} />);
    const summary = () => within(screen.getByTestId("node-summary"));
    // «Вы здесь» is selected first.
    expect(summary().getByRole("link", { name: "Продолжить" })).toHaveAttribute("href", `/courses/kardio/steps/${ID.s2}`);
    await waitFor(() => expect(summary().getByText("Урок пройден, когда пройдены все шаги.")).toBeInTheDocument());
    fireEvent.click(node(/Сбор анамнеза\. Пройден/));
    expect(summary().getByRole("link", { name: "Повторить" })).toHaveAttribute("href", `/courses/kardio/steps/${ID.s1}`);
    fireEvent.click(node(/Итоговый тест\. Закрыт/));
    expect(summary().getByText("Шаг откроется, когда будут пройдены предыдущие.")).toBeInTheDocument();
    expect(summary().queryByRole("link")).toBeNull();
  });

  it("EARS-14: on the narrow axis a selected node opens its summary in a Sheet", () => {
    stubMatchMedia(true);
    render(<CoursePath courseSlug="kardio" config={CONFIG} initial={coursePath()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(node(/Памятка по ЭКГ\. Открыт/));
    const sheet = within(screen.getByRole("dialog"));
    expect(sheet.getByText("Памятка по ЭКГ")).toBeInTheDocument();
    expect(sheet.getByRole("link", { name: "Начать" })).toHaveAttribute("href", `/courses/kardio/steps/${ID.s3}`);
  });
});

describe("024 EARS-14 — summaryAction", () => {
  const view = buildPathView(coursePath());
  const nodes = view.sections.flatMap((s) => s.nodes);
  const byId = (id: string) => nodes.find((n) => n.id === id)!;
  const hrefs = { step: "/step", register: "/register?returnTo=%2Fcourses%2Fkardio" };

  it("EARS-14: a guest gets the registration door on any step", () => {
    expect(summaryAction(byId(ID.s4), false, hrefs)).toEqual({ kind: "guest", href: hrefs.register });
  });
  it("EARS-14: a locked step offers no action", () => {
    expect(summaryAction(byId(ID.s4), true, hrefs)).toBeNull();
  });
  it("EARS-14: done → «Повторить», «Вы здесь» → «Продолжить», open → «Начать»", () => {
    expect(summaryAction(byId(ID.s1), true, hrefs)?.kind).toBe("repeat");
    expect(summaryAction(byId(ID.s2), true, hrefs)?.kind).toBe("continue");
    expect(summaryAction(byId(ID.s3), true, hrefs)?.kind).toBe("start");
  });
  it("EARS-14: the document node offers no action", () => {
    expect(summaryAction(byId("document"), true, hrefs)).toBeNull();
  });
});
