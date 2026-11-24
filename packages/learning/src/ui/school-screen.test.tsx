// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LearningSchoolCourse, LearningSchoolRead } from "@ds/schemas";

import { SchoolScreen, SchoolScreenSkeleton } from "./school-screen";
import { CONFIG } from "./__tests__/fixtures";
import { schoolInterestFetch, soonSchool } from "./__tests__/school-soon";

// 023 EARS-4, EARS-5, EARS-8, EARS-22, EARS-23 — the school screen of
// `design-source/doctor-school.dc.html`: the poster header, «О школе», the
// courses as the doctor content card and the guest gate.

const uuid = (n: number) =>
  `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;

function course(
  n: number,
  over: Partial<LearningSchoolCourse> = {},
): LearningSchoolCourse {
  return {
    id: uuid(100 + n),
    slug: `course-${n}`,
    title: `Курс номер ${n}`,
    description: `Описание курса ${n}.`,
    lessonCount: 4 + n,
    academicHours: 2 * n,
    document: { kind: "certificate", prerequisites: "" },
    partner: null,
    state: null,
    nextLessonNumber: null,
    ...over,
  };
}

function school(over: Partial<LearningSchoolRead> = {}): LearningSchoolRead {
  return {
    school: {
      id: uuid(1),
      slug: "orto",
      title: "Школа ортобиологии",
      description: "Образовательный трек ортобиологии.",
      facts: [
        { label: "Формат", text: "Один модуль — один клинический случай" },
        { label: "Сюжет", text: "Сквозной клинический сюжет" },
      ],
      soonNote: null,
      communityUrl: null,
      mentoringOffer: null,
      internshipOffer: null,
      status: "open",
      courseCount: 2,
      lessonCount: 11,
    },
    direction: { slug: "travma", title: "Травматология и ортопедия" },
    expert: {
      slug: "petrov",
      name: "Пётр Петров",
      role: "Ортопед",
      credentials: null,
      affiliation: null,
      photoUrl: null,
    },
    signedIn: true,
    interested: false,
    courses: [course(1), course(2)],
    ...over,
  };
}

describe("023 — the school screen", () => {
  it("023 EARS-4: the poster header shows the breadcrumb, title, description, expert and the counts from the read", () => {
    render(<SchoolScreen config={CONFIG} read={school()} />);
    const crumbs = within(screen.getByRole("navigation", { name: "Вы здесь" }));
    expect(crumbs.getByText("Травматология и ортопедия")).toBeInTheDocument();
    expect(crumbs.getByText("Школа ортобиологии")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Школа ортобиологии" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Образовательный трек ортобиологии."),
    ).toBeInTheDocument();
    expect(screen.getByText("2 курса · 11 уроков")).toBeInTheDocument();
    expect(screen.getByText(/Пётр Петров/)).toBeInTheDocument();
  });

  it("023 EARS-4: without facts there is no «О школе» section", () => {
    render(
      <SchoolScreen
        config={CONFIG}
        read={school({ school: { ...school().school, facts: [] } })}
      />,
    );
    expect(
      screen.queryByRole("heading", { level: 2, name: "О школе" }),
    ).toBeNull();
  });

  it("023 EARS-4: «О школе» lists at most four facts, each a label and a text", () => {
    const facts = Array.from({ length: 5 }, (_, i) => ({
      label: `Факт ${i + 1}`,
      text: `Текст ${i + 1}`,
    }));
    render(
      <SchoolScreen
        config={CONFIG}
        read={school({ school: { ...school().school, facts } })}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "О школе" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Факт 4")).toBeInTheDocument();
    expect(screen.queryByText("Факт 5")).toBeNull();
  });

  it("023 EARS-4: the loading state is the canvas skeleton, announced as busy", () => {
    render(<SchoolScreenSkeleton />);
    expect(
      screen.getByRole("status", { name: "Школа загружается" }),
    ).toHaveAttribute("aria-busy", "true");
  });

  it("023 EARS-5: each course is a content card in school order with lessons, academic hours, document and a link to its path", () => {
    render(
      <SchoolScreen
        config={CONFIG}
        read={school({
          courses: [
            course(1),
            course(2, {
              document: { kind: "certificate-nmo", prerequisites: "" },
            }),
          ],
        })}
      />,
    );
    const cards = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href")?.startsWith("/courses/"));
    expect(cards.map((a) => a.getAttribute("href"))).toEqual([
      "/courses/course-1",
      "/courses/course-2",
    ]);
    expect(cards[0]).toHaveTextContent("5");
    expect(cards[0]).toHaveTextContent("уроков");
    expect(cards[0]).toHaveTextContent("2 академических часа · Сертификат");
    expect(cards[1]).toHaveTextContent(
      "4 академических часа · Сертификат и НМО",
    );
    expect(cards[0]).toHaveTextContent("Открыть путь курса →");
  });

  it("023 EARS-5: a card carries the doctor's state — done and started", () => {
    render(
      <SchoolScreen
        config={CONFIG}
        read={school({
          courses: [
            course(1, { state: "done" }),
            course(2, { state: "started", nextLessonNumber: 3 }),
          ],
        })}
      />,
    );
    const [done, started] = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href")?.startsWith("/courses/"));
    expect(done).toHaveTextContent("✓ Завершено");
    // Canvas `doctor-school.dc.html`: a done card opens the course path again.
    expect(done).toHaveTextContent("Открыть путь курса →");
    // A started card names the doctor's next lesson; never a percent (023-design §4).
    expect(started).toHaveTextContent("Продолжить — урок 3 →");
    expect(started?.textContent).not.toMatch(/%/);
  });

  it("023 EARS-22: the partner mark appears only on a course with a partner", () => {
    render(
      <SchoolScreen
        config={CONFIG}
        read={school({
          courses: [course(1, { partner: { name: "Партнёр А" } }), course(2)],
        })}
      />,
    );
    expect(screen.getAllByText(/Партнёрский материал/)).toHaveLength(1);
    expect(
      screen.getByText("Партнёрский материал · Партнёр А"),
    ).toBeInTheDocument();
  });

  it("023 EARS-8: a guest reads the school and its courses and meets the registration gate returning to the school", () => {
    render(<SchoolScreen config={CONFIG} read={school({ signedIn: false })} />);
    expect(
      screen
        .getAllByRole("link")
        .filter((a) => a.getAttribute("href")?.startsWith("/courses/")),
    ).toHaveLength(2);
    expect(
      screen.getByText("Начать урок — нужна регистрация. Вернём вас сюда."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Зарегистрироваться" }),
    ).toHaveAttribute("href", "/register?returnTo=%2Fschools%2Forto");
  });

  it("023 EARS-8: a signed-in doctor meets no registration gate", () => {
    render(<SchoolScreen config={CONFIG} read={school()} />);
    expect(
      screen.queryByRole("link", { name: "Зарегистрироваться" }),
    ).toBeNull();
  });

  it("023 EARS-23: the counts follow the read and the screen says nothing of money, «проект», «сериал» or «серий»", () => {
    const { container } = render(
      <SchoolScreen
        config={CONFIG}
        read={school({
          school: { ...school().school, courseCount: 1, lessonCount: 21 },
          courses: [course(1)],
        })}
      />,
    );
    expect(screen.getByText("1 курс · 21 урок")).toBeInTheDocument();
    const text = (container.textContent ?? "").toLowerCase();
    for (const banned of [
      "бесплат",
      "оплат",
      "деньг",
      "рубл",
      "₽",
      "проект",
      "сериал",
      "серий",
      "путь (duolingo)",
      "открытый курс",
      "дпо / аккредитация",
    ]) {
      expect(text).not.toContain(banned);
    }
  });

  describe("023 EARS-5: more than six courses", () => {
    const many = (n: number, over: (i: number) => Partial<LearningSchoolCourse> = () => ({})) =>
      Array.from({ length: n }, (_, i) =>
        course(i + 1, { title: i === 4 ? "Тендинопатии" : `Курс номер ${i + 1}`, ...over(i + 1) }),
      );
    const rows = (container: HTMLElement) =>
      [...container.querySelectorAll('[data-feed-card="content-row"]')] as HTMLAnchorElement[];
    const cards = (container: HTMLElement) =>
      [...container.querySelectorAll('[data-feed-card="content"]')] as HTMLAnchorElement[];

    it("023 EARS-5: at six courses every course is a card and there is no search", () => {
      const { container } = render(<SchoolScreen config={CONFIG} read={school({ courses: many(6) })} />);
      expect(cards(container)).toHaveLength(6);
      expect(rows(container)).toHaveLength(0);
      expect(screen.queryByRole("searchbox", { name: "Найти курс" })).toBeNull();
    });

    it("023 EARS-5: a guest sees no «Вы учитесь» — every course is a row in school order, ten at a time", () => {
      const { container } = render(
        <SchoolScreen config={CONFIG} read={school({ signedIn: false, courses: many(22) })} />,
      );
      expect(screen.queryByText("Вы учитесь")).toBeNull();
      expect(cards(container)).toHaveLength(0);
      expect(screen.getByText("Все курсы школы · 22")).toBeInTheDocument();
      expect(rows(container).map((a) => a.getAttribute("href"))).toEqual(
        Array.from({ length: 10 }, (_, i) => `/courses/course-${i + 1}`),
      );
      expect(rows(container)[0]).toHaveTextContent("Курс");
      expect(rows(container)[0]).toHaveTextContent("5 уроков");
    });

    it("023 EARS-5: «Показать ещё 10» reveals the next ten rows until none is left", () => {
      const { container } = render(<SchoolScreen config={CONFIG} read={school({ courses: many(22) })} />);
      fireEvent.click(screen.getByRole("button", { name: "Показать ещё 10 · осталось 12" }));
      expect(rows(container)).toHaveLength(20);
      fireEvent.click(screen.getByRole("button", { name: "Показать ещё 2 · осталось 2" }));
      expect(rows(container)).toHaveLength(22);
      expect(screen.queryByRole("button", { name: /Показать ещё/ })).toBeNull();
    });

    it("023 EARS-5: the doctor's started and done courses are cards under «Вы учитесь», the rest are rows", () => {
      const { container } = render(
        <SchoolScreen
          config={CONFIG}
          read={school({
            courses: many(22, (i) =>
              i === 2 ? { state: "started", nextLessonNumber: 8 } : i === 6 ? { state: "done" } : { state: "not-started" },
            ),
          })}
        />,
      );
      expect(screen.getByRole("heading", { level: 3, name: "Вы учитесь" })).toBeInTheDocument();
      const mine = cards(container);
      expect(mine.map((a) => a.getAttribute("href"))).toEqual(["/courses/course-2", "/courses/course-6"]);
      expect(mine[0]).toHaveTextContent("Продолжить — урок 8 →");
      expect(mine[1]).toHaveTextContent("Открыть путь курса →");
      expect(screen.getByText("Остальные курсы школы · 20")).toBeInTheDocument();
      const hrefs = rows(container).map((a) => a.getAttribute("href"));
      expect(hrefs).toHaveLength(10);
      expect(hrefs).not.toContain("/courses/course-2");
      expect(hrefs).not.toContain("/courses/course-6");
    });

    it("023 EARS-5: «Найти курс» filters the rows by title over the whole list", () => {
      const { container } = render(<SchoolScreen config={CONFIG} read={school({ courses: many(62) })} />);
      const search = screen.getByRole("searchbox", { name: "Найти курс" });
      fireEvent.change(search, { target: { value: "тенд" } });
      expect(rows(container).map((a) => a.textContent)).toEqual([expect.stringContaining("Тендинопатии")]);
      expect(screen.getByText("Все курсы школы · 1")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Показать ещё/ })).toBeNull();
      // A title past the first ten rows is found too: the search runs over the whole list.
      fireEvent.change(search, { target: { value: "номер 61" } });
      expect(rows(container).map((a) => a.getAttribute("href"))).toEqual(["/courses/course-61"]);
    });

    it("023 EARS-5: a search with no match names the query", () => {
      const { container } = render(<SchoolScreen config={CONFIG} read={school({ courses: many(22) })} />);
      fireEvent.change(screen.getByRole("searchbox", { name: "Найти курс" }), { target: { value: "гастро" } });
      expect(rows(container)).toHaveLength(0);
      expect(
        screen.getByText("По запросу «гастро» курсов в этой школе нет. Попробуйте другое слово."),
      ).toBeInTheDocument();
    });
  });
});

describe("023 — the «скоро» school and the interest capture", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });
  const soon = (over: Partial<LearningSchoolRead> = {}) =>
    soonSchool(school(over));
  const PUT = `PUT /v1/me/learning/schools/${uuid(1)}/interest`;
  const DELETE = `DELETE /v1/me/learning/schools/${uuid(1)}/interest`;

  it("EARS-6: a soon school shows «Скоро» in the header, «Школа готовится» with its note, the capture and the empty events and reviews", () => {
    render(<SchoolScreen config={CONFIG} read={soon()} />);
    expect(screen.getByText("Скоро")).toBeInTheDocument();
    const courses = within(screen.getByRole("region", { name: "Курсы школы" }));
    expect(courses.getByText("Школа готовится")).toBeInTheDocument();
    expect(
      courses.getByText("Первые курсы готовим вместе с экспертами"),
    ).toBeInTheDocument();
    expect(
      courses.getByRole("button", { name: "Сообщить об открытии" }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Вебинары-разборы" })).getByText(
        /Событий школы пока нет/,
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Отзывы выпускников" })).getByText(
        /Отзывов пока нет/,
      ),
    ).toBeInTheDocument();
  });

  it("EARS-6: without a note the soon state fixes no date or season", () => {
    const read = soon();
    render(
      <SchoolScreen
        config={CONFIG}
        read={{ ...read, school: { ...read.school, soonNote: null } }}
      />,
    );
    const region = screen.getByRole("region", { name: "Курсы школы" });
    expect(region.textContent).not.toMatch(
      /осен|зим|весн|летом|январ|феврал|март|апрел|июн|июл|август|сентябр|октябр|ноябр|декабр|20\d\d/i,
    );
  });

  it("EARS-6: an open school keeps its counts and shows no soon state", () => {
    render(<SchoolScreen config={CONFIG} read={school()} />);
    expect(screen.queryByText("Скоро")).not.toBeInTheDocument();
    expect(screen.queryByText("Школа готовится")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Сообщить об открытии" }),
    ).not.toBeInTheDocument();
  });

  it("EARS-7: a signed-in doctor's capture stores the interest and shows «Вы в списке»; a withdraw shows the capture again", async () => {
    const fetch = schoolInterestFetch({ [PUT]: "active", [DELETE]: "withdrawn" });
    render(<SchoolScreen config={CONFIG} read={soon()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Сообщить об открытии" }));
    });
    expect(await screen.findByText("Вы в списке")).toBeInTheDocument();
    expect(fetch.calls()).toEqual([PUT]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Не сообщать" }));
    });
    expect(
      await screen.findByRole("button", { name: "Сообщить об открытии" }),
    ).toBeInTheDocument();
    expect(fetch.calls()).toEqual([PUT, DELETE]);
  });

  it("EARS-7: a doctor already in the list sees «Вы в списке» from the read", () => {
    render(<SchoolScreen config={CONFIG} read={soon({ interested: true })} />);
    expect(screen.getByText("Вы в списке")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Не сообщать" })).toBeInTheDocument();
  });

  it("EARS-7: a failed interest write keeps the capture and says so", async () => {
    schoolInterestFetch({ [PUT]: 500 });
    render(<SchoolScreen config={CONFIG} read={soon()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Сообщить об открытии" }));
    });
    expect(
      await screen.findByText("Не удалось записать вас в список. Попробуйте ещё раз."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Вы в списке")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Сообщить об открытии" }),
    ).toBeEnabled();
  });

  it("EARS-7: a guest's capture leads to registration with the school and the capture marker as the return target", () => {
    render(
      <SchoolScreen config={CONFIG} read={soon({ signedIn: false, interested: null })} />,
    );
    const link = screen.getByRole("link", { name: "Сообщить об открытии" });
    expect(link).toHaveAttribute(
      "href",
      `/register?returnTo=${encodeURIComponent("/schools/orto?capture=interest")}`,
    );
    // The open school's lesson gate stays off the soon school.
    expect(screen.queryByText(/Начать урок/)).not.toBeInTheDocument();
  });

  it("EARS-7: back from registration the same capture completes once and the marker is dropped", async () => {
    window.history.replaceState(null, "", "/schools/orto?capture=interest");
    const fetch = schoolInterestFetch({ [PUT]: "active" });
    render(<SchoolScreen config={CONFIG} read={soon()} />);
    expect(await screen.findByText("Вы в списке")).toBeInTheDocument();
    await waitFor(() => expect(fetch.calls()).toEqual([PUT]));
    expect(window.location.search).toBe("");
  });
});
