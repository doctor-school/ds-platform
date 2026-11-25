import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applicationsCopy as copy } from "../copy";
import { ApplyPage, type ApplyPageProps } from "./apply-page";

const CONSENT = "2026-11-25.sha256-" + "a".repeat(64);

const VIEWER = { displayName: "Анна Крылова", email: "anna@example.test" };

function props(over: Partial<ApplyPageProps> = {}): ApplyPageProps {
  return {
    viewer: VIEWER,
    homeHref: "/",
    gate: {
      signInHref: "/login?returnTo=%2Fapply",
    },
    form: {
      consentVersion: CONSENT,
      policyHref: "/documents",
      specialties: [
        {
          code: "travmatologiya-i-ortopediya",
          name: "Травматология и ортопедия",
        },
        { code: "revmatologiya", name: "Ревматология" },
      ],
    },
    ...over,
  };
}

type Call = { url: string; init: RequestInit };
let calls: Call[];
let answerPost: () => Promise<Response>;
let answerRead: () => Promise<Response>;

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );

beforeEach(() => {
  calls = [];
  answerRead = () => json(200, { items: [] });
  answerPost = () =>
    json(201, {
      id: "0193b6c2-6c1a-7000-8000-000000000001",
      submittedAt: "2026-11-25T10:00:00.000Z",
    });
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return init.method === "POST" ? answerPost() : answerRead();
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const posts = () => calls.filter((c) => c.init.method === "POST");
const keyOf = (c: Call) =>
  (c.init.headers as Record<string, string>)["idempotency-key"];

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^Тема/), "Ортобиология");
  await user.click(screen.getByRole("button", { name: "курс-сериал" }));
  await user.click(screen.getByRole("checkbox", { name: copy.form.consent }));
}

describe("ApplyPage", () => {
  it("EARS-1: the page names what an expert can make, the path in order and the author terms — no producer, no expert link", () => {
    render(<ApplyPage {...props({ viewer: null })} />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Заявка автора" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/курс-сериал, отдельный урок, подкаст или выступление/),
    ).toBeInTheDocument();
    const path = screen.getByRole("region", { name: "Что будет дальше" });
    const titles = within(path)
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    expect(titles).toEqual([
      "Разбор заявки",
      "Разговор с командой",
      "Программа",
      "Производство",
      "Медицинская экспертиза",
      "Публикация",
    ]);
    expect(
      within(path).getByText(/администратор Академии/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Условия автора" }),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/продюсер/i);
    expect(document.body.textContent).not.toMatch(/Куда можно вырасти/);
    expect(document.body.textContent).not.toMatch(/Клинический случай/);
    for (const a of screen.getAllByRole("link"))
      expect(a.getAttribute("href")).not.toMatch(/expert/);
  });

  it("EARS-3: a guest sees the account gate with one «Войти / Регистрация» action returning to /apply, and no form field", () => {
    render(<ApplyPage {...props({ viewer: null })} />);
    expect(
      screen.getByRole("heading", { name: copy.gate.title }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Заявка отправляется под той же учётной записью, что у врача/,
      ),
    ).toBeInTheDocument();
    const actions = screen.getAllByRole("link", { name: /Войти|Регистрац/ });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toHaveAccessibleName("Войти / Регистрация");
    expect(actions[0]).toHaveAttribute("href", "/login?returnTo=%2Fapply");
    expect(screen.queryByText("Я вошёл — вернуться к заявке")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    // A guest is not read for open applications.
    expect(calls).toEqual([]);
  });

  it("EARS-4: a signed-in expert sees who sends and the fields, required ones marked; «Другое» reveals its text field", async () => {
    const user = userEvent.setup();
    render(<ApplyPage {...props()} />);
    expect(
      screen.getByText(
        `Отправите как Анна Крылова · anna@example.test${copy.form.sendingAsTail}`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Тема обязательно")).toBeRequired();
    expect(screen.getByRole("group", { name: /Формат/ })).toHaveTextContent(
      "обязательно",
    );
    for (const f of ["курс-сериал", "отдельный урок", "подкаст", "выступление"])
      expect(screen.getByRole("button", { name: f })).toBeInTheDocument();
    expect(screen.getByLabelText("О себе")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: copy.form.consent }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("link", { name: copy.form.consentPolicy }),
    ).toHaveAttribute("href", "/documents");

    expect(screen.queryByLabelText(/Ваша специальность/)).toBeNull();
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Другое" }));
    expect(screen.getByLabelText(/Ваша специальность/)).toBeInTheDocument();
  });

  it("EARS-5: a missing topic sends nothing, says what to fix, takes focus and keeps the rest", async () => {
    const user = userEvent.setup();
    render(<ApplyPage {...props()} />);
    await user.click(screen.getByRole("button", { name: "подкаст" }));
    await user.click(screen.getByRole("checkbox", { name: copy.form.consent }));
    await user.type(screen.getByLabelText("О себе"), "Травматолог");
    await user.click(screen.getByRole("button", { name: copy.form.submit }));

    expect(posts()).toHaveLength(0);
    expect(screen.getByText(copy.errors.topicRequired)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Тема/)).toHaveFocus();
    expect(screen.getByLabelText(/^Тема/)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByRole("button", { name: "подкаст" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("О себе")).toHaveValue("Травматолог");
  });

  it("EARS-5: an unticked consent sends nothing and the consent row says so", async () => {
    const user = userEvent.setup();
    render(<ApplyPage {...props()} />);
    await user.type(screen.getByLabelText(/^Тема/), "Ортобиология");
    await user.click(screen.getByRole("button", { name: "курс-сериал" }));
    await user.click(screen.getByRole("button", { name: copy.form.submit }));
    expect(posts()).toHaveLength(0);
    expect(
      screen.getByText("Отметьте согласие — без него заявку не отправить."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: copy.form.consent }),
    ).toHaveFocus();
  });

  it("EARS-5: a 400 refusal with a field error shows next to that field and keeps the input", async () => {
    const user = userEvent.setup();
    answerPost = () =>
      json(400, {
        problems: [{ code: "SPECIALTY_UNKNOWN", field: "specialtyCode" }],
      });
    render(<ApplyPage {...props()} />);
    await fillValid(user);
    await user.click(screen.getByRole("combobox"));
    await user.click(
      await screen.findByRole("option", { name: "Ревматология" }),
    );
    await user.click(screen.getByRole("button", { name: copy.form.submit }));
    expect(
      await screen.findByText(copy.errors.specialtyUnknown),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Тема/)).toHaveValue("Ортобиология");
    expect(screen.getByRole("combobox")).toHaveFocus();
  });

  it("EARS-8: a server failure keeps the input and the retry sends the same key; in flight the button is disabled", async () => {
    const user = userEvent.setup();
    answerPost = () => Promise.reject(new TypeError("network"));
    render(<ApplyPage {...props()} />);
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: copy.form.submit }));

    expect(await screen.findByText(copy.unavailable.lead)).toBeInTheDocument();
    expect(screen.getByText(copy.unavailable.rest)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Тема/)).toHaveValue("Ортобиология");

    let release!: (r: Response) => void;
    answerPost = () =>
      new Promise<Response>((r) => {
        release = r;
      });
    await user.click(
      screen.getByRole("button", { name: copy.unavailable.retry }),
    );
    const submit = screen.getByRole("button", { name: /Отправ/ });
    expect(submit).toBeDisabled();
    await user.click(submit);
    expect(posts()).toHaveLength(2);
    expect(keyOf(posts()[1]!)).toBe(keyOf(posts()[0]!));
    release(
      new Response(
        JSON.stringify({
          id: "0193b6c2-6c1a-7000-8000-000000000001",
          submittedAt: "2026-11-25T10:00:00.000Z",
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );
    expect(
      await screen.findByRole("heading", { name: copy.sent.title }),
    ).toBeInTheDocument();
  });

  it("EARS-9: a success replaces the form with «Заявка отправлена»; «ещё одну» opens an empty form with a new key", async () => {
    const user = userEvent.setup();
    render(<ApplyPage {...props()} />);
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: copy.form.submit }));
    expect(
      await screen.findByRole("heading", { name: copy.sent.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(copy.sent.text)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Тема/)).toBeNull();
    const body = JSON.parse(posts()[0]!.init.body as string);
    expect(body).toEqual({
      topic: "Ортобиология",
      format: "course_series",
      consentVersion: CONSENT,
    });

    await user.click(screen.getByRole("button", { name: copy.sent.another }));
    expect(screen.getByLabelText(/^Тема/)).toHaveValue("");
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: copy.form.submit }));
    await screen.findByRole("heading", { name: copy.sent.title });
    expect(posts()).toHaveLength(2);
    expect(keyOf(posts()[1]!)).not.toBe(keyOf(posts()[0]!));
  });

  it("EARS-10: an open application shows the repeat banner above the form; a failed read hides it and keeps the form", async () => {
    answerRead = () =>
      json(200, {
        items: [
          {
            id: "0193b6c2-6c1a-7000-8000-000000000009",
            submittedAt: "2026-11-20T10:00:00.000Z",
            topic: "Ортобиология",
            state: "received",
          },
        ],
      });
    const { unmount } = render(<ApplyPage {...props()} />);
    expect(await screen.findByText(copy.repeatBanner.lead)).toBeInTheDocument();
    expect(screen.getByText(copy.repeatBanner.rest)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Тема/)).toBeInTheDocument();
    expect(calls[0]!.url).toBe("/v1/me/applications?kind=author");
    unmount();

    answerRead = () => json(500, {});
    render(<ApplyPage {...props()} />);
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(screen.queryByText(copy.repeatBanner.lead)).toBeNull();
    expect(screen.getByLabelText(/^Тема/)).toBeInTheDocument();
  });
});
