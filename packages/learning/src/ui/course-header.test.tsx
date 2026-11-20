// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CoursePath } from "./course-path";
import {
  CONFIG,
  ID,
  coursePath,
  lessonRead,
  multiModulePath,
  stubFetch,
  stubMatchMedia,
} from "./__tests__/fixtures";

// 023 EARS-11, EARS-12, EARS-13, EARS-21, EARS-22, EARS-23 — the course header
// over the 024 path block, and the one-module mode of the path.

const SUMMARY =
  "Следующий урок открывается, когда пройден предыдущий. Курс засчитывается, когда пройдены все уроки. Сертификат выдаётся за весь курс.";

describe("023 — the course header", () => {
  beforeEach(() => {
    stubMatchMedia(false);
    stubFetch({ [`GET /v1/learning/lessons/${ID.l2}`]: lessonRead() });
  });
  afterEach(() => vi.unstubAllGlobals());

  const header = (over: Parameters<typeof coursePath>[0] = {}) => {
    const base = coursePath();
    return coursePath({
      ...over,
      course: { ...base.course, rulesSummary: SUMMARY, ...over.course },
    });
  };

  it("023 EARS-11: the header shows the school breadcrumb leading back to the school, title, description, author, hours and lessons", () => {
    render(
      <CoursePath courseSlug="kardio" config={CONFIG} initial={header()} />,
    );
    const crumbs = within(screen.getByRole("navigation", { name: "Вы здесь" }));
    expect(crumbs.getByRole("link", { name: "Школа сердца" })).toHaveAttribute(
      "href",
      "/schools/school-a",
    );
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Кардиология для практика",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Курс для практикующего врача."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Курс · 2 урока · 12 академических часов"),
    ).toBeInTheDocument();
    expect(screen.getByText("Анна Иванова, Кардиолог")).toBeInTheDocument();
  });

  it("023 EARS-11, EARS-13: the header shows the document with its prerequisites and the rules summary with the certificate sentence", () => {
    render(
      <CoursePath
        courseSlug="kardio"
        config={CONFIG}
        initial={header({
          course: {
            ...coursePath().course,
            rulesSummary: SUMMARY,
            document: {
              kind: "certificate-nmo",
              prerequisites: "Подтверждённый диплом",
            },
          },
        })}
      />,
    );
    expect(screen.getByText("Сертификат и НМО")).toBeInTheDocument();
    expect(screen.getByText("Подтверждённый диплом")).toBeInTheDocument();
    expect(screen.getByText(SUMMARY)).toBeInTheDocument();
    expect(
      screen.getByText(/Сертификат выдаётся за весь курс/),
    ).toBeInTheDocument();
  });

  it("023 EARS-11: no prerequisites row without prerequisites", () => {
    render(
      <CoursePath courseSlug="kardio" config={CONFIG} initial={header()} />,
    );
    expect(screen.queryByText("Что нужно для документа")).toBeNull();
  });

  it("023 EARS-22: the partner mark shows only WHILE the course carries a partner", () => {
    const { unmount } = render(
      <CoursePath courseSlug="kardio" config={CONFIG} initial={header()} />,
    );
    expect(screen.queryByText(/Партнёрский материал/)).toBeNull();
    unmount();
    render(
      <CoursePath
        courseSlug="kardio"
        config={CONFIG}
        initial={header({
          course: {
            ...coursePath().course,
            rulesSummary: SUMMARY,
            partner: { name: "Партнёр Б" },
          },
        })}
      />,
    );
    expect(
      screen.getByText("Партнёрский материал · Партнёр Б"),
    ).toBeInTheDocument();
  });

  it("023 EARS-12: a one-module course shows no module level — no module header or number, no «модуль 1 из 1»", () => {
    const { container } = render(
      <CoursePath courseSlug="kardio" config={CONFIG} initial={header()} />,
    );
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/модуль 1 из 1/i);
    expect(text).not.toMatch(/Модуль 1\./);
    expect(text).not.toMatch(/1 модуль/);
    expect(screen.queryByRole("button", { name: /^Модуль/ })).toBeNull();
  });

  it("023 EARS-12: a multi-module course keeps its module count in the eyebrow", () => {
    render(
      <CoursePath
        courseSlug="kardio"
        config={CONFIG}
        initial={multiModulePath(3, 2, 1)}
      />,
    );
    expect(screen.getByText(/^Курс · 3 модуля · \d+ урок/)).toBeInTheDocument();
  });

  it("023 EARS-21: a lesson's step link opens the 024 step route inside its course", () => {
    render(
      <CoursePath courseSlug="kardio" config={CONFIG} initial={header()} />,
    );
    const links = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href") ?? "");
    expect(links.some((h) => h.startsWith("/courses/kardio/steps/"))).toBe(
      true,
    );
  });

  it("023 EARS-23: the header names no rules preset and says nothing of money, «проект» or «сериал»", () => {
    const { container } = render(
      <CoursePath courseSlug="kardio" config={CONFIG} initial={header()} />,
    );
    const text = (container.textContent ?? "").toLowerCase();
    for (const banned of [
      "бесплат",
      "оплат",
      "деньг",
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
