// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { LearningSchoolCourse, LearningSchoolRead } from "@ds/schemas";

import { SchoolScreen, SchoolScreenSkeleton } from "./school-screen";
import { CONFIG } from "./__tests__/fixtures";

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
            course(2, { state: "started" }),
          ],
        })}
      />,
    );
    const [done, started] = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href")?.startsWith("/courses/"));
    expect(done).toHaveTextContent("✓ Завершено");
    expect(done).toHaveTextContent("Открыть снова →");
    expect(started).toHaveTextContent("Продолжить →");
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
});
