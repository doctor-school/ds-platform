// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CourseCompositionScreen } from "./course-composition";
import {
  AID,
  PRESETS,
  course,
  fakeTransport,
  refusal,
  rules,
} from "./__tests__/fixtures";

// 024 EARS-28 (reaching a module's lessons) and EARS-29 slice 1 (preset choice
// on a course): the course's modules and lessons, a new module and a new lesson,
// and «Применить пресет» with each preset's settings in words.

function mount(transport = fakeTransport(), roles = ["platform_admin"]) {
  render(
    <CourseCompositionScreen
      courseId={AID.course}
      transport={transport}
      staffRoles={roles}
      lessonHref={(id) => `/learning/lessons/${id}`}
    />,
  );
  return transport;
}

describe("CourseCompositionScreen", () => {
  it("EARS-29: links to the rules editor of the course, its school and each module", async () => {
    render(
      <CourseCompositionScreen
        courseId={AID.course}
        transport={fakeTransport()}
        staffRoles={["platform_admin"]}
        lessonHref={(id) => `/learning/lessons/${id}`}
        rulesHref={(kind, id) => `/learning/rules/${kind}/${id}`}
      />,
    );
    expect(
      await screen.findByRole("link", { name: "Правила курса" }),
    ).toHaveAttribute("href", `/learning/rules/course/${AID.course}`);
    expect(screen.getByRole("link", { name: "Правила школы" })).toHaveAttribute(
      "href",
      `/learning/rules/school/${AID.school}`,
    );
    expect(
      within(screen.getByTestId("module-1")).getByRole("link", {
        name: "Правила модуля",
      }),
    ).toHaveAttribute("href", `/learning/rules/module/${AID.module}`);
  });

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

  it("EARS-29: the picker starts on the preset the course has applied, not on the first one", async () => {
    mount(
      fakeTransport({
        rules: async () =>
          rules({ appliedPreset: PRESETS[1]!.name, layerVersion: 3 }),
      }),
    );
    const panel = await screen.findByTestId("preset-panel");
    const applied = await within(panel).findByLabelText(PRESETS[1]!.name);
    await waitFor(() => expect(applied).toBeChecked());
    for (const other of PRESETS.filter((_, i) => i !== 1))
      expect(within(panel).getByLabelText(other.name)).not.toBeChecked();
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

  it("EARS-30: on a once-published course a staff member without the rules editor role sees the presets read-only, with the reason", async () => {
    const t = mount(
      fakeTransport({
        rules: async () =>
          rules({ authority: "rules-editor", layerVersion: 2 }),
      }),
      ["platform_admin"],
    );
    const panel = await screen.findByTestId("preset-panel");
    expect(
      await within(panel).findByTestId("rules-read-only"),
    ).toHaveTextContent(
      "Правила опубликованного курса меняет только редактор правил обучения.",
    );
    expect(within(panel).getByLabelText("Путь (Duolingo)")).toBeDisabled();
    expect(
      within(panel).getByRole("button", { name: "Применить пресет" }),
    ).toBeDisabled();
    expect(t.previewRules).not.toHaveBeenCalled();
  });

  it("EARS-30: the rules editor role offers the preset on a once-published course", async () => {
    mount(
      fakeTransport({
        rules: async () =>
          rules({ authority: "rules-editor", layerVersion: 2 }),
      }),
      ["platform_admin", "learning_rules_editor"],
    );
    const panel = await screen.findByTestId("preset-panel");
    fireEvent.click(await within(panel).findByLabelText("Путь (Duolingo)"));
    expect(
      within(panel).getByRole("button", { name: "Применить пресет" }),
    ).toBeEnabled();
    expect(
      within(panel).queryByTestId("rules-read-only"),
    ).not.toBeInTheDocument();
  });

  // ── 023 EARS-27 (#4018) — the course's data, publish, modules ───────────

  it("023 EARS-27: links back to the course's school", async () => {
    render(
      <CourseCompositionScreen
        courseId={AID.course}
        transport={fakeTransport()}
        staffRoles={["platform_admin"]}
        lessonHref={(id) => `/learning/lessons/${id}`}
        schoolHref={(id) => `/learning/schools/${id}`}
      />,
    );
    expect(
      await screen.findByRole("link", { name: "К школе" }),
    ).toHaveAttribute("href", `/learning/schools/${AID.school}`);
  });

  it("023 EARS-27: saves the course's EARS-1 data under the course's version", async () => {
    const t = mount();
    fireEvent.change(await screen.findByLabelText("Описание курса"), {
      target: { value: "Ритм и проводимость" },
    });
    fireEvent.change(screen.getByLabelText("Академических часов"), {
      target: { value: "36" },
    });
    fireEvent.click(screen.getByLabelText("Сертификат с баллами НМО"));
    fireEvent.change(screen.getByLabelText("Что нужно для документа"), {
      target: { value: "Подтверждённые документы" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() =>
      expect(t.updateCourse).toHaveBeenCalledWith(
        AID.course,
        {
          title: "ЭКГ с нуля",
          description: "Ритм и проводимость",
          academicHours: 36,
          documentKind: "certificate-nmo",
          documentPrerequisites: "Подтверждённые документы",
        },
        2,
      ),
    );
    expect(await screen.findByTestId("write-saved")).toHaveTextContent(
      "Сохранено.",
    );
  });

  it("023 EARS-27: publishing a course without a published lesson is refused in staff words", async () => {
    const t = mount(
      fakeTransport({
        publishCourse: async () => {
          throw refusal("PUBLISH_REQUIREMENTS_NOT_MET", [
            { path: "lessons", message: "publish at least one lesson" },
          ]);
        },
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Опубликовать курс" }),
    );
    expect(
      await screen.findByText(/в нём нет опубликованного урока/),
    ).toBeInTheDocument();
    expect(t.course).toHaveBeenCalledTimes(1);
  });

  it("023 EARS-27: publishes a draft course under its version", async () => {
    const t = mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Опубликовать курс" }),
    );
    await waitFor(() =>
      expect(t.publishCourse).toHaveBeenCalledWith(AID.course, 2),
    );
  });

  it("023 EARS-27: renames a module under the module's version", async () => {
    const t = mount();
    fireEvent.change(await screen.findByLabelText("Новое название модуля 1"), {
      target: { value: "Ритм сердца" },
    });
    fireEvent.click(
      within(screen.getByTestId("module-1")).getByRole("button", {
        name: "Переименовать",
      }),
    );
    await waitFor(() =>
      expect(t.updateModule).toHaveBeenCalledWith(
        AID.module,
        { title: "Ритм сердца" },
        1,
      ),
    );
  });

  it("023 EARS-27: moves a module up — the new order under the course's version", async () => {
    const two = course();
    two.modules.push({
      id: AID.module2,
      courseId: AID.course,
      position: 2,
      title: "Блокады",
      version: 1,
      lessons: [],
    });
    const t = mount(fakeTransport({ course: async () => two }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Поднять модуль 2" }),
    );
    await waitFor(() =>
      expect(t.reorderModules).toHaveBeenCalledWith(
        AID.course,
        [AID.module2, AID.module],
        2,
      ),
    );
  });
  it("023 EARS-27: unsaved course data survive a publish, and the save then carries the new version", async () => {
    let version = 2;
    const t = mount(
      fakeTransport({
        course: vi.fn(async () => ({ ...course(), version })),
        publishCourse: async () => {
          version = 3;
          return { ...course(), version: 3, state: "published" } as never;
        },
      }),
    );
    fireEvent.change(await screen.findByLabelText("Описание курса"), {
      target: { value: "Несохранённый текст" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Опубликовать курс" }));
    await waitFor(() => expect(t.course).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText("Описание курса")).toHaveValue(
      "Несохранённый текст",
    );
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() =>
      expect(t.updateCourse).toHaveBeenCalledWith(
        AID.course,
        expect.objectContaining({ description: "Несохранённый текст" }),
        3,
      ),
    );
  });

  it("023 EARS-27: course data changed on the server replace the form's copy", async () => {
    let description = "Старое описание";
    let version = 2;
    mount(
      fakeTransport({
        course: async () => ({ ...course(), description, version }),
        publishCourse: async () => {
          description = "Описание коллеги";
          version = 4;
          return course() as never;
        },
      }),
    );
    expect(await screen.findByLabelText("Описание курса")).toHaveValue(
      "Старое описание",
    );
    fireEvent.click(screen.getByRole("button", { name: "Опубликовать курс" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Описание курса")).toHaveValue(
        "Описание коллеги",
      ),
    );
  });
});
