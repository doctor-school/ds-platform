// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CourseCompositionScreen } from "./course-composition";
import {
  AID,
  PRESETS,
  fakeTransport,
  refusal,
  rules,
} from "./__tests__/fixtures";

// 024 EARS-28 (reaching a module's lessons) and EARS-29 slice 1 (preset choice
// on a course): the course's modules and lessons, a new module and a new lesson,
// and «Применить пресет» with each preset's settings in words.

function mount(transport = fakeTransport()) {
  render(
    <CourseCompositionScreen
      courseId={AID.course}
      transport={transport}
      lessonHref={(id) => `/learning/lessons/${id}`}
    />,
  );
  return transport;
}

describe("CourseCompositionScreen", () => {
  it("EARS-28: lists the course's modules and their lessons, each lesson linking to its composition", async () => {
    mount();
    expect(
      await screen.findByRole("heading", { level: 1, name: "ЭКГ с нуля" }),
    ).toBeInTheDocument();
    const module = screen.getByTestId("module-1");
    expect(
      within(module).getByRole("heading", { name: "Модуль 1. Ритм" }),
    ).toBeInTheDocument();
    const link = within(module).getByRole("link", {
      name: /Урок 1\. Основы ЭКГ/,
    });
    expect(link).toHaveAttribute("href", `/learning/lessons/${AID.lesson}`);
    expect(within(module).getByText(/Черновик · 15 мин/)).toBeInTheDocument();
  });

  it("EARS-28: adds a module to the course", async () => {
    const t = mount();
    fireEvent.change(await screen.findByLabelText("Название модуля"), {
      target: { value: "Блокады" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Добавить модуль" }));
    await waitFor(() =>
      expect(t.createModule).toHaveBeenCalledWith({
        courseId: AID.course,
        title: "Блокады",
      }),
    );
    await waitFor(() => expect(t.course).toHaveBeenCalledTimes(2));
  });

  it("EARS-28: adds a lesson (title, description, teaser) to a module under the course's project", async () => {
    const t = mount();
    const module = await screen.findByTestId("module-1");
    fireEvent.change(within(module).getByLabelText("Название урока"), {
      target: { value: "Синусовый ритм" },
    });
    fireEvent.change(within(module).getByLabelText("Описание"), {
      target: { value: "Как узнать" },
    });
    fireEvent.change(within(module).getByLabelText("Анонс"), {
      target: { value: "Пять признаков" },
    });
    fireEvent.click(
      within(module).getByRole("button", { name: "Добавить урок" }),
    );
    await waitFor(() =>
      expect(t.createLesson).toHaveBeenCalledWith({
        moduleId: AID.module,
        projectId: AID.project,
        title: "Синусовый ритм",
        description: "Как узнать",
        teaser: "Пять признаков",
      }),
    );
  });

  it("EARS-29: lists the presets from the API with the settings each sets, in words", async () => {
    mount();
    const panel = await screen.findByTestId("preset-panel");
    const path = await within(panel).findByTestId(`preset-${AID.path}`);
    expect(within(path).getByText("Путь (Duolingo)")).toBeInTheDocument();
    expect(path).toHaveTextContent("Порядок шагов: строго по порядку");
    expect(path).toHaveTextContent("Открытие: после предыдущего");
    expect(path).toHaveTextContent("Итоговый тест обязателен: да");
    const open = within(panel).getByTestId(`preset-${AID.open}`);
    expect(open).toHaveTextContent(
      "Когда урок пройден: все условия — все шаги пройдены; итоговый тест сдан",
    );
  });

  it("EARS-29: applies the chosen preset on the course and says lower overrides stay", async () => {
    const t = mount();
    const panel = await screen.findByTestId("preset-panel");
    fireEvent.click(await within(panel).findByLabelText("Путь (Duolingo)"));
    fireEvent.click(
      within(panel).getByRole("button", { name: "Применить пресет" }),
    );
    await waitFor(() =>
      expect(t.applyPreset).toHaveBeenCalledWith(
        "course",
        AID.course,
        AID.path,
        0,
      ),
    );
    expect(await within(panel).findByRole("status")).toHaveTextContent(
      "Пресет «Путь (Duolingo)» применён к курсу. Настройки, заданные в модулях, уроках и шагах, сохранены.",
    );
    expect(
      within(panel).getByText("Применён: Путь (Duolingo)"),
    ).toBeInTheDocument();
  });

  it("EARS-29: the preset already applied is marked", async () => {
    mount(
      fakeTransport({
        rules: async () =>
          rules({ appliedPreset: PRESETS[1]!.name, layerVersion: 3 }),
      }),
    );
    const panel = await screen.findByTestId("preset-panel");
    expect(
      await within(panel).findByText("Применён: Открытый курс"),
    ).toBeInTheDocument();
  });

  it("EARS-29: a refused apply changes nothing and names its field errors", async () => {
    mount(
      fakeTransport({
        applyPreset: async () => {
          throw refusal(
            "VALIDATION_FAILED",
            [{ path: "presetId", message: "unknown preset" }],
            400,
          );
        },
      }),
    );
    const panel = await screen.findByTestId("preset-panel");
    fireEvent.click(await within(panel).findByLabelText("Открытый курс"));
    fireEvent.click(
      within(panel).getByRole("button", { name: "Применить пресет" }),
    );
    expect(await within(panel).findByTestId("write-refusal")).toHaveTextContent(
      "Пресет: unknown preset",
    );
    expect(within(panel).queryByText(/Применён:/)).not.toBeInTheDocument();
  });
});
