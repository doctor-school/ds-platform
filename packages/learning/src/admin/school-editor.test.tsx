// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SchoolEditorScreen } from "./school-editor";
import { AID, fakeTransport, refusal, school } from "./__tests__/fixtures";

// 023 EARS-26, EARS-27 (#4018) — the school editor: the school's EARS-1 data,
// publish / unpublish, the interest count, the school's courses in order with
// «Выше / Ниже», and a new course placed last.

function mount(transport = fakeTransport()) {
  render(
    <SchoolEditorScreen
      schoolId={AID.school}
      transport={transport}
      courseHref={(id) => `/learning/courses/${id}`}
    />,
  );
  return transport;
}

describe("SchoolEditorScreen", () => {
  it("EARS-26: shows the school, its draft state, the interest count and its courses in order linking to each course", async () => {
    mount();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Школа кардиологии" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("school-state")).toHaveTextContent("Черновик");
    expect(screen.getByText("Ждут открытия школы: 7")).toBeInTheDocument();
    const list = screen.getByTestId("school-courses");
    const links = within(list).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["ЭКГ с нуля", "ЭхоКГ"]);
    expect(links[0]).toHaveAttribute("href", `/learning/courses/${AID.course}`);
  });

  it("EARS-26: saves the EARS-1 data under the school's version; an emptied optional text is sent as null", async () => {
    const t = mount();
    fireEvent.change(await screen.findByLabelText("Название школы"), {
      target: { value: "Школа сердца" },
    });
    fireEvent.change(screen.getByLabelText("Пометка «скоро»"), {
      target: { value: "Готовим первый курс" },
    });
    fireEvent.change(screen.getByLabelText("Ссылка на сообщество (https)"), {
      target: { value: "https://t.me/cardio" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Добавить факт" }));
    fireEvent.change(screen.getByLabelText("Факт 2 — заголовок"), {
      target: { value: "Документ" },
    });
    fireEvent.change(screen.getByLabelText("Факт 2 — текст"), {
      target: { value: "Сертификат" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() =>
      expect(t.updateSchool).toHaveBeenCalledWith(
        AID.school,
        {
          title: "Школа сердца",
          description: "Сердце и сосуды",
          facts: [
            { label: "Формат", text: "Видео и тесты" },
            { label: "Документ", text: "Сертификат" },
          ],
          soonNote: "Готовим первый курс",
          communityUrl: "https://t.me/cardio",
          mentoringOffer: null,
          internshipOffer: null,
        },
        4,
      ),
    );
    expect(await screen.findByText("Сохранено.")).toBeInTheDocument();
  });

  it("EARS-26: offers at most four facts", async () => {
    mount();
    const add = await screen.findByRole("button", { name: "Добавить факт" });
    fireEvent.click(add);
    fireEvent.click(add);
    fireEvent.click(add);
    expect(screen.getByLabelText("Факт 4 — заголовок")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Добавить факт" }),
    ).not.toBeInTheDocument();
  });

  it("EARS-26: publishes a draft school under its version and unpublishes a published one", async () => {
    const t = mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Опубликовать школу" }),
    );
    await waitFor(() =>
      expect(t.publishSchool).toHaveBeenCalledWith(AID.school, 4),
    );
    const published = fakeTransport({
      school: async () => school({ state: "published" }),
    });
    const { unmount } = render(
      <SchoolEditorScreen
        schoolId={AID.school}
        transport={published}
        courseHref={(id) => `/learning/courses/${id}`}
      />,
    );
    const unpublish = await screen.findByRole("button", {
      name: "Снять школу с публикации",
    });
    fireEvent.click(unpublish);
    await waitFor(() =>
      expect(published.unpublishSchool).toHaveBeenCalledWith(AID.school, 4),
    );
    unmount();
  });

  it("EARS-27: moves a course down — the new order under the school's version", async () => {
    const t = mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Опустить курс «ЭКГ с нуля»" }),
    );
    await waitFor(() =>
      expect(t.reorderCourses).toHaveBeenCalledWith(
        AID.school,
        [AID.course2, AID.course],
        4,
      ),
    );
    // The list is re-read from the server after the write.
    await waitFor(() => expect(t.schoolCourses).toHaveBeenCalledTimes(2));
  });

  it("EARS-27: creates a course in the school with the school's project", async () => {
    const t = mount();
    fireEvent.change(await screen.findByLabelText("Название курса"), {
      target: { value: "Аритмии" },
    });
    fireEvent.change(
      screen.getByLabelText("Адрес курса (латиница, цифры и дефисы)"),
      { target: { value: "arrhythmia" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Создать курс" }));
    await waitFor(() =>
      expect(t.createCourse).toHaveBeenCalledWith({
        schoolId: AID.school,
        projectId: AID.project,
        title: "Аритмии",
        slug: "arrhythmia",
      }),
    );
  });

  it("EARS-28: a stale write says so in staff words and reloads the school", async () => {
    const t = fakeTransport({
      updateSchool: async () => {
        throw refusal("PRECONDITION_FAILED", [], 412);
      },
    });
    mount(t);
    fireEvent.click(await screen.findByRole("button", { name: "Сохранить" }));
    expect(
      await screen.findByText(/Данные изменили в другом окне/),
    ).toBeInTheDocument();
    await waitFor(() => expect(t.school).toHaveBeenCalledTimes(2));
  });

  it("EARS-27: a taken course slug is refused in staff words", async () => {
    mount(
      fakeTransport({
        createCourse: async () => {
          throw refusal("SLUG_CONFLICT");
        },
      }),
    );
    fireEvent.change(await screen.findByLabelText("Название курса"), {
      target: { value: "Аритмии" },
    });
    fireEvent.change(
      screen.getByLabelText("Адрес курса (латиница, цифры и дефисы)"),
      { target: { value: "ekg" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Создать курс" }));
    expect(
      await screen.findByText("Этот адрес уже занят — выберите другой."),
    ).toBeInTheDocument();
  });
});
