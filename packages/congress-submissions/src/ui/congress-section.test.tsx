import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type {
  CongressSubmission,
  CongressSubmissionKindIntake,
  CongressSubmissionSection,
} from "@ds/schemas";

import { CongressSection } from "./congress-section";

const HOST = {
  accountHref: "/account",
  eventHrefPrefix: "/events/",
  signInHref: "/login?returnTo=%2Faccount%2Fcongress",
};

const EVENT_ID = "00000000-0000-4000-8000-00000000000e";

function kind(
  k: CongressSubmissionKindIntake["kind"],
  over: Partial<CongressSubmissionKindIntake> = {},
): CongressSubmissionKindIntake {
  return {
    kind: k,
    state: "open",
    opensAt: "2026-11-01T21:00:00.000Z",
    closesAt: "2027-01-15T21:00:00.000Z",
    lastDay: "2027-01-15",
    submitLimit: null,
    used: 0,
    offered: k === "oral",
    maxAgeYears: null,
    ...over,
  };
}

function sub(over: Partial<CongressSubmission> = {}): CongressSubmission {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    eventId: EVENT_ID,
    kind: "oral",
    status: "submitted",
    title: "PRP при латеральном эпикондилите",
    authors: [],
    body: {},
    committeeComment: null,
    submittedAt: "2026-12-16T15:40:00.000Z",
    revisionDueAt: null,
    statusChangedAt: "2026-12-16T15:40:00.000Z",
    updatedAt: "2026-12-16T15:40:00.000Z",
    createdAt: "2026-12-10T09:00:00.000Z",
    ...over,
  };
}

function section(
  over: Partial<CongressSubmissionSection> = {},
): CongressSubmissionSection {
  return {
    eventId: EVENT_ID,
    event: {
      slug: "orthobio-2027",
      title: "VIII конгресс «Ортобиология»",
      startsAt: "2027-04-23T06:00:00.000Z",
      endsAt: "2027-04-24T15:00:00.000Z",
    },
    registered: true,
    registrationUrl: "https://orthobio.ru/#join",
    consentRequired: true,
    birthDate: null,
    kinds: [kind("oral"), kind("poster"), kind("abstract", { submitLimit: 3 })],
    submissions: [],
    ...over,
  };
}

function answer(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("CongressSection", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/account/congress");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("EARS-4: the heading names the section and the event, with the account and congress links", async () => {
    fetchMock.mockResolvedValue(answer(section({ submissions: [sub()] })));
    render(<CongressSection host={HOST} />);
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Мои заявки на Конгресс",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("VIII конгресс «Ортобиология» · 23–24 апреля 2027"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Аккаунт" })).toHaveAttribute(
      "href",
      "/account",
    );
    expect(
      screen.getByRole("link", { name: "Страница Конгресса ↗" }),
    ).toHaveAttribute("href", "/events/orthobio-2027");
    // The host shell owns the page's one `main` landmark (V-18 axe: no nested main).
    expect(screen.queryByRole("main")).toBeNull();
  });

  it("EARS-5: without a registration only the line and the registration link show", async () => {
    fetchMock.mockResolvedValue(answer(section({ registered: false })));
    render(<CongressSection host={HOST} />);
    expect(
      await screen.findByText("Сначала зарегистрируйтесь участником Конгресса"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Регистрация на сайте Конгресса ↗" }),
    ).toHaveAttribute("href", "https://orthobio.ru/#join");
    // Canvas «нет регистрации»: the link is the 14px/700 step (Link `sm`).
    const reg = screen.getByRole("link", {
      name: "Регистрация на сайте Конгресса ↗",
    });
    expect(reg).toHaveClass("text-sm", "font-bold", "underline");
    expect(screen.queryByText("Новая заявка")).not.toBeInTheDocument();
  });

  it("EARS-4: a failed read says so and retries", async () => {
    fetchMock.mockResolvedValueOnce(answer({}, 503));
    fetchMock.mockResolvedValueOnce(answer(section({ submissions: [sub()] })));
    render(<CongressSection host={HOST} />);
    expect(
      await screen.findByText("Не удалось загрузить заявки"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(
      await screen.findByText("PRP при латеральном эпикондилите"),
    ).toBeInTheDocument();
  });

  it("EARS-4: a guest whose session is gone goes to the sign-in door", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign, search: "" });
    fetchMock.mockResolvedValue(answer({}, 401));
    render(<CongressSection host={HOST} />);
    await waitFor(() => expect(assign).toHaveBeenCalledWith(HOST.signInHref));
  });

  it("EARS-6: with no submissions the kind choice shows; only the oral talk can be started", async () => {
    fetchMock.mockResolvedValue(
      answer(
        section({
          kinds: [
            kind("oral"),
            kind("poster", {
              state: "not-yet-open",
              opensAt: "2027-01-19T21:00:00.000Z",
            }),
            kind("abstract", {
              state: "not-announced",
              opensAt: null,
              submitLimit: 3,
            }),
          ],
        }),
      ),
    );
    render(<CongressSection host={HOST} />);
    const oral = await screen.findByTestId("congress-pick-oral");
    expect(
      within(oral).getByText("Приём до 15 января 2027 включительно"),
    ).toBeInTheDocument();
    expect(
      within(oral).getByRole("button", { name: "Начать заявку →" }),
    ).toBeEnabled();
    expect(
      within(oral).getByRole("button", { name: "Начать заявку →" }),
    ).toHaveClass("text-sm");
    // Canvas «выбор вида»: every kind name is the 17px/800 lead step.
    for (const k of ["oral", "poster", "abstract"]) {
      const name = within(screen.getByTestId(`congress-pick-${k}`)).getByRole(
        "heading",
        { level: 3 },
      );
      expect(name).toHaveClass("text-lead", "font-extrabold");
      expect(name).not.toHaveClass("text-lg");
    }
    for (const k of ["poster", "abstract"]) {
      expect(
        within(screen.getByTestId(`congress-pick-${k}`)).queryByRole("button"),
      ).toBeNull();
    }
    // EARS-10: every kind card carries its own intake line from the read —
    // a kind whose form is not offered yet shows it too, just with no start.
    expect(
      within(screen.getByTestId("congress-pick-poster")).getByText(
        "Приём откроется 20 января 2027",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("congress-pick-abstract")).getByText(
        "Дату открытия приёма объявят позже",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/откроется позже/)).toBeNull();
  });

  it("EARS-11: rows carry status, meta, the committee comment and the revision deadline; the filter narrows them", async () => {
    const due = new Date(Date.now() + 5 * 86_400_000).toISOString();
    fetchMock.mockResolvedValue(
      answer(
        section({
          submissions: [
            sub(),
            sub({
              id: "00000000-0000-4000-8000-000000000002",
              status: "needs_revision",
              title: "Комбинация PRP и гиалуроновой кислоты",
              committeeComment: "Уточните дизайн исследования",
              revisionDueAt: due,
            }),
          ],
        }),
      ),
    );
    render(<CongressSection host={HOST} />);
    const rows = await screen.findAllByTestId("congress-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("Отправлена")).toBeInTheDocument();
    // The row's text action is the canvas `textAction` step (14px), not the
    // row title's body size.
    expect(
      within(rows[0]!).getByRole("button", {
        name: "Забрать на исправление →",
      }),
    ).toHaveClass("text-sm");
    expect(
      within(rows[1]!).getByText("Уточните дизайн исследования"),
    ).toBeInTheDocument();
    expect(
      within(rows[1]!).getByText(/^Исправить и отправить до .* · осталось/),
    ).toBeInTheDocument();
    // A row's secondary action is the canvas `quietBtn` step (13px/600).
    const quiet = within(rows[1]!).getByRole("button", { name: "Отозвать" });
    expect(quiet).toHaveClass("text-caption", "font-semibold");
    expect(quiet).not.toHaveClass("text-sm");

    await userEvent.click(screen.getByRole("button", { name: /На доработке/ }));
    expect(screen.getAllByTestId("congress-row")).toHaveLength(1);
  });

  it("EARS-11: every canvas `quietBtn` — «Свернуть», «Читать целиком», the ask's «Отмена», the author toggle — is the 13px/600 step", async () => {
    const quiet = (el: HTMLElement) => {
      expect(el).toHaveClass("text-caption", "font-semibold");
      expect(el).not.toHaveClass("text-sm");
      expect(el).not.toHaveClass("font-bold");
    };
    fetchMock.mockResolvedValueOnce(
      answer(
        section({
          submissions: [
            sub({
              status: "needs_revision",
              committeeComment: "Уточните дизайн исследования. ".repeat(8),
              revisionDueAt: new Date(
                Date.now() + 5 * 86_400_000,
              ).toISOString(),
            }),
          ],
        }),
      ),
    );
    render(<CongressSection host={HOST} />);
    const row = (await screen.findAllByTestId("congress-row"))[0]!;
    quiet(within(row).getByRole("button", { name: "Читать целиком" }));

    await userEvent.click(
      screen.getByRole("button", { name: "+ Новая заявка" }),
    );
    quiet(screen.getByRole("button", { name: "Свернуть" }));

    await userEvent.click(
      within(row).getByRole("button", { name: "Отозвать" }),
    );
    const ask = screen.getByRole("group", { name: /Отозвать заявку\?/ });
    quiet(within(ask).getByRole("button", { name: "Отмена" }));
  });

  it("EARS-7: the author row's «Изменить» toggle is the canvas `quietBtn` step", async () => {
    const draft = sub({
      status: "draft",
      submittedAt: null,
      authors: [
        {
          surname: "Орлов",
          firstName: "Виктор",
          workplace: "ГКБ № 12",
          presenting: true,
        },
      ],
    });
    window.history.replaceState(
      null,
      "",
      `/account/congress?submission=${draft.id}`,
    );
    fetchMock.mockResolvedValueOnce(answer(section({ submissions: [draft] })));
    render(<CongressSection host={HOST} />);
    const toggle = await screen.findByRole("button", { name: "Изменить" });
    expect(toggle).toHaveClass("text-caption", "font-semibold");
    expect(toggle).not.toHaveClass("text-sm");
    expect(toggle).not.toHaveClass("font-bold");
  });

  it("EARS-7/9: the oral draft saves on blur; a send with gaps lists each one, the consent included", async () => {
    const draft = sub({
      status: "draft",
      title: "",
      submittedAt: null,
      authors: [
        {
          surname: "Орлов",
          firstName: "Виктор",
          workplace: "ГКБ № 12",
          presenting: true,
        },
      ],
    });
    window.history.replaceState(
      null,
      "",
      `/account/congress?submission=${draft.id}`,
    );
    fetchMock.mockResolvedValueOnce(answer(section({ submissions: [draft] })));
    render(<CongressSection host={HOST} />);
    const topic = await screen.findByLabelText("Тема");
    expect(screen.getByText("Формат участия — очный")).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(answer({ ...draft, title: "PRP" }));
    await userEvent.type(topic, "PRP");
    await userEvent.tab();
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([, i]) => (i as RequestInit | undefined)?.method === "PATCH",
        ),
      ).toBe(true),
    );
    const patch = fetchMock.mock.calls.find(
      ([, i]) => (i as RequestInit | undefined)?.method === "PATCH",
    )!;
    expect(JSON.parse(String((patch[1] as RequestInit).body))).toMatchObject({
      title: "PRP",
    });

    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));
    const summary = await screen.findByRole("alert");
    expect(
      within(summary).getByText("Заявка не отправлена. Исправьте 3 ошибки:"),
    ).toBeInTheDocument();
    expect(
      within(summary).getByText("Заполните поле «Образовательная цель»"),
    ).toBeInTheDocument();
    expect(
      within(summary).getByText(
        "Дайте согласие на обработку персональных данных",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "обработку персональных данных" }),
    ).toHaveAttribute("href", "/documents/consent-congress-submissions");
    // The label is the consent name alone (owner decision 2026-09-30): the
    // document covers more purposes than one review tail could name.
    expect(
      screen.getByRole("checkbox", {
        name: "Согласие на обработку персональных данных",
      }),
    ).toBeInTheDocument();
  });

  const complete = {
    title: "PRP при латеральном эпикондилите",
    authors: [
      {
        surname: "Орлов",
        firstName: "Виктор",
        workplace: "ГКБ № 12",
        presenting: true,
      },
    ],
    body: { goal: "Разобрать показания.", summary: "Краткое содержание." },
  };

  it("046 EARS-30: a needs_revision talk before its deadline is resent; a refusal after the deadline is named, not swallowed", async () => {
    const revision = sub({
      ...complete,
      status: "needs_revision",
      committeeComment: "Уточните цель",
      revisionDueAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    });
    window.history.replaceState(
      null,
      "",
      `/account/congress?submission=${revision.id}`,
    );
    fetchMock.mockResolvedValueOnce(
      answer(section({ consentRequired: false, submissions: [revision] })),
    );
    render(<CongressSection host={HOST} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Отправить снова" }),
    );
    fetchMock.mockResolvedValueOnce(
      answer(
        {
          problems: [
            {
              code: "revision-closed",
              // The server's deadline passed 5 hours ago.
              params: {
                revisionDueAt: new Date(
                  Date.now() - 5 * 3_600_000 - 60_000,
                ).toISOString(),
              },
            },
          ],
        },
        422,
      ),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Да, отправить снова" }),
    );
    const summary = await screen.findByRole("alert");
    expect(
      within(summary).getByText(
        /^Срок доработки истёк \d{1,2} [а-я]+, 23:59 МСК \(5 часов назад\) — отправить заявку нельзя$/,
      ),
    ).toBeInTheDocument();
  });

  it("046 EARS-30: after the revision deadline the talk is read-only with the canvas line, no «Отправить снова»", async () => {
    const late = sub({
      ...complete,
      status: "needs_revision",
      committeeComment: "Уточните цель",
      // The deadline passed three days and two hours ago.
      revisionDueAt: new Date(
        Date.now() - 3 * 86_400_000 - 2 * 3_600_000,
      ).toISOString(),
    });
    window.history.replaceState(
      null,
      "",
      `/account/congress?submission=${late.id}`,
    );
    fetchMock.mockResolvedValueOnce(answer(section({ submissions: [late] })));
    render(<CongressSection host={HOST} />);
    // The canvas draws the line twice: in the committee box and as the
    // separate ⚠ warn notice of the detail.
    const line =
      /^Срок доработки истёк \d{1,2} [а-я]+, 23:59 МСК \(3 дня назад\) — отправить заявку нельзя$/;
    const lines = await screen.findAllByText(line);
    expect(lines).toHaveLength(2);
    expect(
      within(screen.getByTestId("congress-committee-comment")).getByText(line),
    ).toBeInTheDocument();
    const notice = screen.getByRole("alert");
    expect(within(notice).getByText(line)).toBeInTheDocument();
    expect(notice.textContent).toContain("⚠");
    expect(
      screen.queryByRole("button", { name: "Отправить снова" }),
    ).toBeNull();
  });

  it("EARS-11: the committee comment carries the day of the committee action in the viewer zone, not Moscow", async () => {
    // 15:40Z is 18:40 in Moscow on the 16th and 01:40 on the 17th in the
    // test zone (Vladivostok) — the action date follows the viewer.
    const revision = sub({
      ...complete,
      status: "needs_revision",
      committeeComment: "Уточните цель",
      statusChangedAt: "2026-12-16T15:40:00.000Z",
      revisionDueAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    });
    window.history.replaceState(
      null,
      "",
      `/account/congress?submission=${revision.id}`,
    );
    fetchMock.mockResolvedValueOnce(
      answer(section({ consentRequired: false, submissions: [revision] })),
    );
    render(<CongressSection host={HOST} />);
    expect(
      await screen.findByText(
        "Комментарий программного комитета · 17 декабря 2026",
      ),
    ).toBeInTheDocument();
  });

  it("046 EARS-9: a send refused because the status changed meanwhile reads the section again", async () => {
    const revision = sub({
      ...complete,
      status: "needs_revision",
      committeeComment: "Уточните цель",
      revisionDueAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    });
    window.history.replaceState(
      null,
      "",
      `/account/congress?submission=${revision.id}`,
    );
    fetchMock.mockResolvedValueOnce(
      answer(section({ consentRequired: false, submissions: [revision] })),
    );
    render(<CongressSection host={HOST} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Отправить снова" }),
    );
    fetchMock.mockResolvedValueOnce(
      answer(
        {
          problems: [
            { code: "status-conflict", params: { status: "accepted" } },
          ],
        },
        409,
      ),
    );
    fetchMock.mockResolvedValueOnce(
      answer(
        section({
          consentRequired: false,
          submissions: [
            { ...revision, status: "accepted", committeeComment: null },
          ],
        }),
      ),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Да, отправить снова" }),
    );
    expect(await screen.findByText("Принята")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Отправить снова" }),
    ).toBeNull();
  });

  it("EARS-12: the withdrawn detail dates the notice by the status moment under the canvas «—» icon", async () => {
    const withdrawn = sub({
      ...complete,
      status: "withdrawn",
      submittedAt: "2026-12-10T09:00:00.000Z",
      statusChangedAt: "2026-12-16T15:40:00.000Z",
      updatedAt: "2026-12-10T09:00:00.000Z",
    });
    window.history.replaceState(
      null,
      "",
      `/account/congress?submission=${withdrawn.id}`,
    );
    fetchMock.mockResolvedValueOnce(
      answer(section({ submissions: [withdrawn] })),
    );
    render(<CongressSection host={HOST} />);
    const notice = await screen.findByText(/^Заявка отозвана /);
    expect(notice.textContent).toMatch(/^Заявка отозвана 17 декабря 2026\. /);
    const box = notice.closest('[role="status"]')!;
    expect(within(box as HTMLElement).getByText("—")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("EARS-12: «Отозвать» asks first; confirming withdraws with the status the author saw", async () => {
    const inReview = sub({ status: "in_review" });
    fetchMock.mockResolvedValueOnce(
      answer(section({ submissions: [inReview] })),
    );
    render(<CongressSection host={HOST} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Отозвать" }),
    );
    expect(
      screen.getByText(
        "Отозвать заявку? Комитет её не рассмотрит, вернуть будет нельзя.",
      ),
    ).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(
      answer({ ...inReview, status: "withdrawn" }),
    );
    const ask = screen.getByRole("group", { name: /Отозвать заявку\?/ });
    await userEvent.click(
      within(ask).getByRole("button", { name: "Отозвать" }),
    );
    await screen.findByText("Отозвана");
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe(`/v1/me/congress-submissions/${inReview.id}/withdraw`);
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      expectedStatus: "in_review",
    });
  });
});
