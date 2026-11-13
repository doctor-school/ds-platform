// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LEARNING_ELEMENT_TYPES, STREAM_PROVIDERS } from "@ds/schemas";

import { LessonCompositionScreen } from "./lesson-composition";
import {
  AID,
  downloadStep,
  fakeTransport,
  lesson,
  refusal,
  testStep,
  videoStep,
} from "./__tests__/fixtures";

// 024 EARS-28 (slice 1: video, download, exit test) and EARS-4 — the staff
// lesson composition screen: the lesson, its steps of the catalog types, the
// step inputs each type requires, reorder, remove, publish with every missing
// item named in words, and a refused write naming its field errors.

const PROVIDERS = Object.fromEntries(
  STREAM_PROVIDERS.map((p) => [p, `Площадка ${p}`]),
) as Record<(typeof STREAM_PROVIDERS)[number], string>;

function mount(transport = fakeTransport()) {
  render(
    <LessonCompositionScreen
      lessonId={AID.lesson}
      transport={transport}
      providerLabels={PROVIDERS}
      courseHref="/learning/courses/c"
    />,
  );
  return transport;
}

const row = (n: number) => screen.getByTestId(`step-row-${n}`);
const change = (
  label: string | RegExp,
  value: string,
  root: HTMLElement = document.body,
) =>
  fireEvent.change(within(root).getByLabelText(label), { target: { value } });

describe("LessonCompositionScreen", () => {
  it("EARS-28: shows the lesson, its state, its total duration and its steps in order", async () => {
    mount();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Основы ЭКГ" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Черновик")).toBeInTheDocument();
    expect(screen.getByText(/Длительность урока: 15 мин/)).toBeInTheDocument();
    expect(row(1)).toHaveTextContent("Шаг 1 · Серия · Разбор ЭКГ · 12 мин");
    expect(row(2)).toHaveTextContent(
      "Шаг 2 · Материал для скачивания · Памятка · 3 мин",
    );
  });

  it("EARS-2 / EARS-28: the new step offers exactly the catalog's element types", async () => {
    mount();
    const select = await screen.findByLabelText("Тип шага");
    const values = within(select)
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value);
    expect(values).toEqual([...LEARNING_ELEMENT_TYPES]);
  });

  it("EARS-28: adds a video step with its media length, then reloads the lesson", async () => {
    const t = mount();
    await screen.findByLabelText("Тип шага");
    change("Тип шага", "video");
    change("Название шага", "Ритм сердца");
    change("Длительность шага, мин", "8");
    change("Длина видео, секунд", "420");
    fireEvent.click(screen.getByRole("button", { name: "Добавить шаг" }));
    await waitFor(() =>
      expect(t.createStep).toHaveBeenCalledWith({
        lessonId: AID.lesson,
        type: "video",
        title: "Ритм сердца",
        durationMin: 8,
        payload: { durationSec: 420 },
      }),
    );
    await waitFor(() => expect(t.lesson).toHaveBeenCalledTimes(2));
  });

  it("EARS-28: adds a download step with the file name the doctor saves", async () => {
    const t = mount();
    await screen.findByLabelText("Тип шага");
    change("Тип шага", "download");
    change("Название шага", "Схема");
    change("Длительность шага, мин", "2");
    change("Имя файла у врача", "shema.pdf");
    fireEvent.click(screen.getByRole("button", { name: "Добавить шаг" }));
    await waitFor(() =>
      expect(t.createStep).toHaveBeenCalledWith({
        lessonId: AID.lesson,
        type: "download",
        title: "Схема",
        durationMin: 2,
        payload: { fileName: "shema.pdf" },
      }),
    );
  });

  it("EARS-28: adds an exit test with its questions, options and the one correct option", async () => {
    const t = mount();
    await screen.findByLabelText("Тип шага");
    change("Тип шага", "test");
    change("Название шага", "Итоговый тест");
    change("Длительность шага, мин", "5");
    change("Вопрос 1", "Норма PQ?");
    change("Вопрос 1, вариант 1", "300 мс");
    change("Вопрос 1, вариант 2", "120–200 мс");
    fireEvent.click(screen.getByLabelText("Вопрос 1, вариант 2 — верный"));
    fireEvent.click(screen.getByRole("button", { name: "Добавить шаг" }));
    await waitFor(() =>
      expect(t.createStep).toHaveBeenCalledWith({
        lessonId: AID.lesson,
        type: "test",
        title: "Итоговый тест",
        durationMin: 5,
        payload: {
          kind: "exit",
          questions: [
            {
              text: "Норма PQ?",
              options: [
                { text: "300 мс", correct: false },
                { text: "120–200 мс", correct: true },
              ],
            },
          ],
        },
      }),
    );
  });

  it("EARS-28: a video step without a source takes the provider and the video reference", async () => {
    const t = mount();
    await screen.findByTestId("step-row-1");
    change("Площадка", "youtube", row(1));
    change("Ссылка или идентификатор видео", "dQw4w9WgXcQ", row(1));
    fireEvent.click(
      within(row(1)).getByRole("button", { name: "Сохранить источник" }),
    );
    await waitFor(() =>
      expect(t.setStepSource).toHaveBeenCalledWith(
        AID.s1,
        { provider: "youtube", embedRef: "dQw4w9WgXcQ" },
        1,
      ),
    );
  });

  it("EARS-28: a set source is shown with its provider", async () => {
    mount(
      fakeTransport({
        lesson: async () =>
          lesson({
            steps: [
              videoStep({ source: { provider: "youtube", embedRef: "abc" } }),
            ],
          }),
      }),
    );
    expect(
      await screen.findByText("Источник: Площадка youtube · abc"),
    ).toBeInTheDocument();
  });

  it("EARS-28: a download step uploads its file under the 012 media contract", async () => {
    const t = mount();
    await screen.findByTestId("step-row-2");
    const file = new File(["%PDF-1.4"], "pamyatka.pdf", {
      type: "application/pdf",
    });
    const input = within(row(2)).getByLabelText("Файл") as HTMLInputElement;
    expect(input.accept).toContain("application/pdf");
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(
      within(row(2)).getByRole("button", { name: "Загрузить файл" }),
    );
    await waitFor(() =>
      expect(t.setStepMedia).toHaveBeenCalledWith(AID.s2, file, 1),
    );
  });

  it("EARS-28: an exit test row shows its question count and the threshold its rules resolve", async () => {
    mount(
      fakeTransport({ lesson: async () => lesson({ steps: [testStep()] }) }),
    );
    expect(
      await screen.findByText(/Вопросов: 1 · порог сдачи 70 %/),
    ).toBeInTheDocument();
  });

  it("EARS-28: moves a step up under the lesson's version", async () => {
    const t = mount();
    await screen.findByTestId("step-row-2");
    fireEvent.click(screen.getByRole("button", { name: "Поднять шаг 2" }));
    await waitFor(() =>
      expect(t.reorderSteps).toHaveBeenCalledWith(
        AID.lesson,
        [AID.s2, AID.s1],
        4,
      ),
    );
  });

  it("EARS-28: removes a step under the step's version", async () => {
    const t = mount();
    await screen.findByTestId("step-row-1");
    fireEvent.click(screen.getByRole("button", { name: "Удалить шаг 1" }));
    await waitFor(() => expect(t.removeStep).toHaveBeenCalledWith(AID.s1, 1));
  });

  it("EARS-4: a refused publish names every missing item in words and changes nothing", async () => {
    const t = mount(
      fakeTransport({
        publishLesson: async () => {
          throw refusal("PUBLISH_REQUIREMENTS_NOT_MET", [
            {
              path: "steps.0.source",
              message: "set the video's provider and id",
            },
            { path: "steps.1.media", message: "upload the step's file" },
            { path: "exitTest", message: "the rules require an exit test" },
          ]);
        },
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Опубликовать урок" }),
    );
    const alert = await screen.findByTestId("publish-refusal");
    expect(alert).toHaveTextContent("Урок пока нельзя опубликовать");
    const items = within(alert)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(items).toEqual([
      "Шаг 1 «Разбор ЭКГ»: укажите площадку и ссылку на видео.",
      "Шаг 2 «Памятка»: загрузите файл.",
      "Правила курса требуют итоговый тест — добавьте шаг «Тест».",
    ]);
    expect(screen.getByText("Черновик")).toBeInTheDocument();
    expect(t.lesson).toHaveBeenCalledTimes(1);
  });

  it("EARS-4: an accepted publish shows the lesson published and offers unpublish", async () => {
    const t = mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Опубликовать урок" }),
    );
    await waitFor(() =>
      expect(t.publishLesson).toHaveBeenCalledWith(AID.lesson, 4),
    );
    expect(await screen.findByText("Опубликован")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Снять с публикации" }),
    ).toBeInTheDocument();
  });

  it("EARS-28: a refused write changes nothing and names its field errors", async () => {
    const t = mount(
      fakeTransport({
        setStepSource: async () => {
          throw refusal(
            "VALIDATION_FAILED",
            [{ path: "embedRef", message: "not a YouTube video id" }],
            400,
          );
        },
      }),
    );
    await screen.findByTestId("step-row-1");
    change("Площадка", "youtube", row(1));
    change("Ссылка или идентификатор видео", "nope", row(1));
    fireEvent.click(
      within(row(1)).getByRole("button", { name: "Сохранить источник" }),
    );
    const alert = await screen.findByTestId("write-refusal");
    expect(alert).toHaveTextContent(
      "Ссылка или идентификатор видео: not a YouTube video id",
    );
    expect(t.lesson).toHaveBeenCalledTimes(1);
  });

  it("EARS-28: a stale version is refused and the screen reloads what the server holds", async () => {
    const t = mount(
      fakeTransport({
        removeStep: async () => {
          throw refusal("PRECONDITION_FAILED", [], 412);
        },
      }),
    );
    await screen.findByTestId("step-row-1");
    fireEvent.click(screen.getByRole("button", { name: "Удалить шаг 1" }));
    expect(await screen.findByTestId("write-refusal")).toHaveTextContent(
      "Урок изменили в другом окне — показана текущая версия.",
    );
    await waitFor(() => expect(t.lesson).toHaveBeenCalledTimes(2));
  });

  it("shows a download step's stored file", async () => {
    mount(
      fakeTransport({
        lesson: async () =>
          lesson({
            steps: [
              downloadStep({
                media: { contentType: "application/pdf", sizeBytes: 2048 },
              }),
            ],
          }),
      }),
    );
    expect(
      await screen.findByText("Файл загружен: application/pdf, 2 КБ"),
    ).toBeInTheDocument();
  });
});
