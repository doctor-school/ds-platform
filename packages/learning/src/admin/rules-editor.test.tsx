// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LearningScopeKind } from "@ds/schemas";

import { RulesEditorScreen } from "./rules-editor";
import {
  AID,
  PRESETS,
  fakeTransport,
  refusal,
  rules,
} from "./__tests__/fixtures";

// 024 EARS-29 (the rules editor of every scope), EARS-30 (who may change which
// rules, read-only otherwise) and EARS-31 (the change dialog of a once-published
// course: the impact count, keep vs require again, If-Match).

const EDITOR = ["platform_admin", "learning_rules_editor"];
const ADMIN_ONLY = ["platform_admin"];

function mount(
  transport = fakeTransport(),
  {
    scopeKind = "module" as LearningScopeKind,
    scopeId = AID.module as string,
    roles = EDITOR,
  } = {},
) {
  render(
    <RulesEditorScreen
      scopeKind={scopeKind}
      scopeId={scopeId}
      transport={transport}
      staffRoles={roles}
    />,
  );
  return transport;
}

const moduleRules = (over: Parameters<typeof rules>[0] = {}) =>
  rules({
    scopeKind: "module",
    scopeId: AID.module,
    layerVersion: 2,
    values: { order: "free" },
    effective: [
      { key: "order", value: "free", level: "module", preset: null },
      {
        key: "test.threshold",
        value: 80,
        level: "course",
        preset: "ДПО / аккредитация",
      },
      { key: "testOut.allowed", value: true, level: "platform", preset: null },
      {
        key: "completion.lesson",
        value: { condition: "all-steps-done" },
        level: "platform",
        preset: null,
      },
    ],
    ...over,
  });

const row = (key: string) => screen.findByTestId(`setting-${key}`);

describe("RulesEditorScreen", () => {
  it("EARS-29: every setting shows its effective value and where it comes from — the level and the preset, or «Задано здесь»", async () => {
    mount(fakeTransport({ rules: async () => moduleRules() }));
    const order = await row("order");
    expect(order).toHaveTextContent("Порядок шагов");
    expect(order).toHaveTextContent("в любом порядке");
    expect(order).toHaveTextContent("Задано здесь");
    const threshold = await row("test.threshold");
    expect(threshold).toHaveTextContent("80 %");
    expect(threshold).toHaveTextContent(
      "Унаследовано от: курс · пресет «ДПО / аккредитация»",
    );
    expect(await row("testOut.allowed")).toHaveTextContent(
      "Унаследовано от: платформа",
    );
  });

  it("EARS-29: an override and «Вернуть унаследованное» write the scope's own values under its version", async () => {
    const t = mount(fakeTransport({ rules: async () => moduleRules() }));
    const threshold = await row("test.threshold");
    fireEvent.click(
      within(threshold).getByRole("button", { name: "Изменить: Порог теста" }),
    );
    fireEvent.change(within(threshold).getByLabelText("Порог теста"), {
      target: { value: "90" },
    });
    fireEvent.click(
      within(await row("order")).getByRole("button", {
        name: "Вернуть унаследованное: Порядок шагов",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Сохранить правила" }));
    await waitFor(() =>
      expect(t.setRules).toHaveBeenCalledWith(
        "module",
        AID.module,
        { values: { "test.threshold": 90 } },
        2,
      ),
    );
    // A draft course's scope takes no change dialog.
    expect(t.previewRules).not.toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Правила сохранены.",
    );
  });

  it("EARS-29: the completion-rule builder writes «N из M» over catalog conditions", async () => {
    const t = mount(fakeTransport({ rules: async () => moduleRules() }));
    const lessonRule = await row("completion.lesson");
    fireEvent.click(
      within(lessonRule).getByRole("button", {
        name: "Изменить: Когда урок пройден",
      }),
    );
    fireEvent.change(within(lessonRule).getByLabelText("Вид правила"), {
      target: { value: "nOf" },
    });
    fireEvent.click(
      within(lessonRule).getByRole("button", { name: "Добавить условие" }),
    );
    fireEvent.click(
      within(lessonRule).getByRole("button", { name: "Добавить условие" }),
    );
    fireEvent.change(within(lessonRule).getByLabelText("Условие 2"), {
      target: { value: "test-passed" },
    });
    fireEvent.change(within(lessonRule).getByLabelText("Условие 3"), {
      target: { value: "watched-at-least" },
    });
    fireEvent.change(within(lessonRule).getByLabelText("Условие 3, процент"), {
      target: { value: "75" },
    });
    fireEvent.change(within(lessonRule).getByLabelText("Сколько условий"), {
      target: { value: "2" },
    });
    expect(lessonRule).toHaveTextContent(
      "2 из 3 — все шаги пройдены; итоговый тест сдан; видео просмотрено от 75 %",
    );
    fireEvent.click(screen.getByRole("button", { name: "Сохранить правила" }));
    await waitFor(() =>
      expect(t.setRules).toHaveBeenCalledWith(
        "module",
        AID.module,
        {
          values: {
            order: "free",
            "completion.lesson": {
              nOf: {
                n: 2,
                of: [
                  { condition: "all-steps-done" },
                  { condition: "test-passed", test: "exit" },
                  { condition: "watched-at-least", percent: 75 },
                ],
              },
            },
          },
        },
        2,
      ),
    );
  });

  it("EARS-29: a refused save changes nothing and names its field errors", async () => {
    const t = mount(
      fakeTransport({
        rules: vi.fn(async () => moduleRules()),
        setRules: async () => {
          throw refusal(
            "VALIDATION_FAILED",
            [
              {
                path: "values.completion.lesson.nOf.n",
                message: "n is between 1 and 3",
              },
            ],
            400,
          );
        },
      }),
    );
    const threshold = await row("test.threshold");
    fireEvent.click(
      within(threshold).getByRole("button", { name: "Изменить: Порог теста" }),
    );
    fireEvent.change(within(threshold).getByLabelText("Порог теста"), {
      target: { value: "90" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить правила" }));
    expect(await screen.findByTestId("write-refusal")).toHaveTextContent(
      "Когда урок пройден: n is between 1 and 3",
    );
    // The screen still shows the scope as read, with the draft kept to fix.
    expect(await row("order")).toHaveTextContent("Задано здесь");
    expect(within(threshold).getByLabelText("Порог теста")).toHaveValue(90);
    expect(t.rules).toHaveBeenCalledTimes(1);
  });

  it("EARS-29: «Применить пресет» is offered at a school and a course, not below", async () => {
    mount(
      fakeTransport({
        rules: async () =>
          rules({ scopeKind: "school", scopeId: AID.school }),
      }),
      { scopeKind: "school", scopeId: AID.school },
    );
    const panel = await screen.findByTestId("preset-panel");
    fireEvent.click(await within(panel).findByLabelText("Открытый курс"));
    expect(
      within(panel).getByRole("button", { name: "Применить пресет" }),
    ).toBeEnabled();
  });

  it("EARS-29: a module's editor has no preset choice", async () => {
    mount(fakeTransport({ rules: async () => moduleRules() }));
    await row("order");
    expect(screen.queryByTestId("preset-panel")).not.toBeInTheDocument();
  });

  it("EARS-29: the platform scope shows each preset's contents and saves an edited preset under its version", async () => {
    const t = mount(
      fakeTransport({
        rules: async () =>
          rules({
            scopeKind: "platform",
            scopeId: "platform",
            authority: "rules-editor",
            layerVersion: 5,
          }),
      }),
      { scopeKind: "platform", scopeId: "platform" },
    );
    const preset = await screen.findByTestId(`preset-contents-${AID.path}`);
    expect(preset).toHaveTextContent("Порядок шагов: строго по порядку");
    fireEvent.click(
      within(preset).getByRole("button", {
        name: "Изменить пресет «Путь (Duolingo)»",
      }),
    );
    fireEvent.change(within(preset).getByLabelText("Порядок шагов"), {
      target: { value: "free" },
    });
    fireEvent.click(
      within(preset).getByRole("button", { name: "Сохранить пресет" }),
    );
    await waitFor(() =>
      expect(t.updatePreset).toHaveBeenCalledWith(
        AID.path,
        { ...PRESETS[0]!.values, order: "free" },
        PRESETS[0]!.version,
      ),
    );
  });

  // ── EARS-30 ────────────────────────────────────────────────────────────────

  it("EARS-30: without `learning_rules_editor` a once-published course's rules are read-only with the reason", async () => {
    mount(
      fakeTransport({
        rules: async () => moduleRules({ authority: "rules-editor" }),
      }),
      { roles: ADMIN_ONLY },
    );
    expect(await screen.findByTestId("rules-read-only")).toHaveTextContent(
      "Правила опубликованного курса меняет только редактор правил обучения.",
    );
    expect(await row("order")).toHaveTextContent("в любом порядке");
    expect(
      screen.queryByRole("button", { name: /^Изменить:/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Сохранить правила" }),
    ).not.toBeInTheDocument();
  });

  it("EARS-30: without `learning_rules_editor` the platform rules and the presets are read-only", async () => {
    mount(
      fakeTransport({
        rules: async () =>
          rules({
            scopeKind: "platform",
            scopeId: "platform",
            authority: "rules-editor",
          }),
      }),
      { scopeKind: "platform", scopeId: "platform", roles: ADMIN_ONLY },
    );
    expect(await screen.findByTestId("rules-read-only")).toHaveTextContent(
      "Правила платформы и пресеты меняет только редактор правил обучения.",
    );
    const preset = await screen.findByTestId(`preset-contents-${AID.path}`);
    expect(
      within(preset).queryByRole("button", { name: /Изменить пресет/ }),
    ).not.toBeInTheDocument();
  });

  it("EARS-30: a 403 on save shows the reason, changes nothing and turns the editor read-only", async () => {
    mount(
      fakeTransport({
        rules: async () => moduleRules(),
        setRules: async () => {
          throw refusal("LEARNING_RULES_EDITOR_REQUIRED", [], 403);
        },
      }),
    );
    const threshold = await row("test.threshold");
    fireEvent.click(
      within(threshold).getByRole("button", { name: "Изменить: Порог теста" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Сохранить правила" }));
    expect(await screen.findByTestId("rules-read-only")).toHaveTextContent(
      "Правила опубликованного курса меняет только редактор правил обучения.",
    );
    expect(
      screen.queryByRole("button", { name: "Сохранить правила" }),
    ).not.toBeInTheDocument();
  });

  // ── EARS-31 ────────────────────────────────────────────────────────────────

  async function raiseThreshold() {
    const threshold = await row("test.threshold");
    fireEvent.click(
      within(threshold).getByRole("button", { name: "Изменить: Порог теста" }),
    );
    fireEvent.change(within(threshold).getByLabelText("Порог теста"), {
      target: { value: "90" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить правила" }));
  }

  it("EARS-31: a once-published course's save first shows the impact count with «keep» preselected, then applies the choice under If-Match", async () => {
    const t = mount(
      fakeTransport({
        rules: async () => moduleRules({ authority: "rules-editor" }),
        previewRules: vi.fn(async () => ({
          affectedDoctors: 12,
          toDone: 0,
          toNotDone: 12,
        })),
      }),
    );
    await raiseThreshold();
    const dialog = await screen.findByTestId("rule-change-dialog");
    expect(t.previewRules).toHaveBeenCalledWith("module", AID.module, {
      order: "free",
      "test.threshold": 90,
    });
    expect(t.setRules).not.toHaveBeenCalled();
    expect(dialog).toHaveTextContent("Изменится статус у 12 врачей");
    expect(
      within(dialog).getByLabelText("Сохранить заработанные зачёты"),
    ).toBeChecked();
    fireEvent.click(within(dialog).getByLabelText("Потребовать заново"));
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Применить изменение" }),
    );
    await waitFor(() =>
      expect(t.setRules).toHaveBeenCalledWith(
        "module",
        AID.module,
        {
          values: { order: "free", "test.threshold": 90 },
          earnedProgress: "require-again",
        },
        2,
      ),
    );
  });

  it("EARS-31: «keep» is what a confirmed change sends when the choice is left as it is", async () => {
    const t = mount(
      fakeTransport({
        rules: async () => moduleRules({ authority: "rules-editor" }),
        previewRules: async () => ({ affectedDoctors: 1, toDone: 0, toNotDone: 1 }),
      }),
    );
    await raiseThreshold();
    const dialog = await screen.findByTestId("rule-change-dialog");
    expect(dialog).toHaveTextContent("Изменится статус у 1 врача");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Применить изменение" }),
    );
    await waitFor(() =>
      expect(t.setRules).toHaveBeenCalledWith(
        "module",
        AID.module,
        expect.objectContaining({ earnedProgress: "keep" }),
        2,
      ),
    );
  });

  it("EARS-31: a stale version is refused, named and the current rules are shown", async () => {
    let reads = 0;
    const t = mount(
      fakeTransport({
        rules: vi.fn(async () =>
          ++reads === 1
            ? moduleRules({ authority: "rules-editor" })
            : moduleRules({ authority: "rules-editor", layerVersion: 3 }),
        ),
        previewRules: async () => ({ affectedDoctors: 0, toDone: 0, toNotDone: 0 }),
        setRules: async () => {
          throw refusal("PRECONDITION_FAILED", [], 412);
        },
      }),
    );
    await raiseThreshold();
    const dialog = await screen.findByTestId("rule-change-dialog");
    expect(dialog).toHaveTextContent("Статус врачей не изменится");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Применить изменение" }),
    );
    expect(await screen.findByTestId("write-refusal")).toHaveTextContent(
      "Правила изменили в другом окне — показана текущая версия.",
    );
    await waitFor(() => expect(t.rules).toHaveBeenCalledTimes(2));
  });
});
