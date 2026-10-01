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
    // Oral talks (S2) and posters (S3) have their forms; abstracts come in S4.
    offered: k !== "abstract",
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

  it("EARS-6: with no submissions the kind choice shows; the offered kinds can be started, a poster before its opening too", async () => {
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
    // EARS-6: a draft may be written before the opening, it just cannot be sent.
    expect(
      within(screen.getByTestId("congress-pick-poster")).getByRole("button", {
        name: "Начать заявку →",
      }),
    ).toBeEnabled();
    expect(
      within(screen.getByTestId("congress-pick-abstract")).queryByRole(
        "button",
      ),
    ).toBeNull();
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

describe("CongressSection — posters (046 EARS-18…20)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/account/congress");
  });
  afterEach(() => vi.unstubAllGlobals());

  const me = {
    surname: "Орлов",
    firstName: "Виктор",
    workplace: "ГКБ № 12",
    presenting: false,
  };
  const posterDraft = sub({
    id: "00000000-0000-4000-8000-0000000000a1",
    kind: "poster",
    status: "draft",
    title: "",
    submittedAt: null,
    authors: [me],
  });
  const kinds40 = [
    kind("oral"),
    kind("poster", { maxAgeYears: 40 }),
    kind("abstract", { submitLimit: 3 }),
  ];
  const callsTo = (method: string) =>
    fetchMock.mock.calls.filter(
      ([, i]) => (i as RequestInit | undefined)?.method === method,
    );
  const openDraft = (id: string) =>
    window.history.replaceState(null, "", `/account/congress?submission=${id}`);

  it("046 EARS-18: the poster form asks for the topic, the authors in publication order with no speaker pick, «Цель» and «Содержание» — no on-site line", async () => {
    fetchMock.mockResolvedValueOnce(
      answer(section({ birthDate: "1990-04-24", kinds: kinds40 })),
    );
    render(<CongressSection host={HOST} />);
    const pick = await screen.findByTestId("congress-pick-poster");
    fetchMock.mockResolvedValueOnce(answer(posterDraft));
    await userEvent.click(
      within(pick).getByRole("button", { name: "Начать заявку →" }),
    );
    expect(await screen.findByLabelText("Цель")).toBeInTheDocument();
    expect(screen.getByLabelText("Содержание")).toBeInTheDocument();
    expect(screen.getByLabelText("Тема")).toBeInTheDocument();
    expect(screen.getByText("Порядок — как в публикации")).toBeInTheDocument();
    expect(screen.queryByText("Формат участия — очный")).toBeNull();
    expect(screen.queryByText("Отметьте одного докладчика")).toBeNull();
    expect(screen.queryByRole("radio", { name: "Докладчик" })).toBeNull();
    expect(screen.queryByLabelText("Образовательная цель")).toBeNull();
    const [url, init] = callsTo("POST")[0]!;
    expect(url).toBe("/v1/me/congress-submissions");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      eventId: EVENT_ID,
      kind: "poster",
    });
  });

  it("046 EARS-18: a poster sent with gaps names its own fields", async () => {
    openDraft(posterDraft.id);
    fetchMock.mockResolvedValueOnce(
      answer(
        section({
          birthDate: "1990-04-24",
          kinds: kinds40,
          consentRequired: false,
          submissions: [{ ...posterDraft, title: "Постер" }],
        }),
      ),
    );
    render(<CongressSection host={HOST} />);
    await screen.findByLabelText("Цель");
    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));
    const summary = await screen.findByRole("alert");
    expect(
      within(summary)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Заполните поле «Цель»", "Заполните поле «Содержание»"]);
  });

  it("046 EARS-19: with no birth date, «Начать заявку» creates the poster draft at once and the draft asks for the birth date — empty or impossible is refused at send, a real day is written through PUT /v1/me/birth-date on blur", async () => {
    fetchMock.mockResolvedValueOnce(
      answer(section({ kinds: kinds40, consentRequired: false })),
    );
    render(<CongressSection host={HOST} />);
    const pick = await screen.findByTestId("congress-pick-poster");
    expect(within(pick).queryByLabelText("Дата рождения")).toBeNull();
    fetchMock.mockResolvedValueOnce(answer(posterDraft));
    await userEvent.click(
      within(pick).getByRole("button", { name: "Начать заявку →" }),
    );
    const field = await screen.findByLabelText("Дата рождения");
    expect(callsTo("POST")).toHaveLength(1);
    expect(callsTo("PUT")).toHaveLength(0);
    expect(field).toHaveValue("");
    expect(field).toHaveAttribute("placeholder", "дд.мм.гггг");
    expect(
      screen.getByText(
        "Спрашиваем один раз — перед первым постером. Постерные доклады принимают от участников младше 40 лет на дату начала Конгресса — 23 апреля 2027.",
      ),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));
    const summary = await screen.findByRole("alert");
    expect(
      within(summary).getByRole("button", { name: "Укажите дату рождения" }),
    ).toBeInTheDocument();
    expect(field).toHaveAttribute("aria-invalid", "true");

    await userEvent.type(field, "31.02.1990");
    await userEvent.tab();
    expect(callsTo("PUT")).toHaveLength(0);

    await userEvent.clear(field);
    await userEvent.type(field, "24.04.1990");
    fetchMock.mockResolvedValueOnce(answer({ birthDate: "1990-04-24" }));
    await userEvent.tab();
    await waitFor(() => expect(callsTo("PUT")).toHaveLength(1));
    const [putUrl, putInit] = callsTo("PUT")[0]!;
    expect(putUrl).toBe("/v1/me/birth-date");
    expect(JSON.parse(String((putInit as RequestInit).body))).toEqual({
      birthDate: "1990-04-24",
    });
  });

  it("046 EARS-19: a birth date the API refuses sits on the field of the draft", async () => {
    openDraft(posterDraft.id);
    fetchMock.mockResolvedValueOnce(
      answer(section({ kinds: kinds40, submissions: [posterDraft] })),
    );
    render(<CongressSection host={HOST} />);
    const field = await screen.findByLabelText("Дата рождения");
    await userEvent.type(field, "01.01.1990");
    fetchMock.mockResolvedValueOnce(answer({ message: "bad" }, 400));
    await userEvent.tab();
    expect(
      await screen.findByText("Укажите дату рождения"),
    ).toBeInTheDocument();
    expect(field).toHaveAttribute("aria-invalid", "true");
  });

  it("046 EARS-19: in the first poster draft the holder corrects the stored date — written on blur; a send refused on `birthDate` names the field", async () => {
    openDraft(posterDraft.id);
    const complete = {
      ...posterDraft,
      title: "Постер",
      body: { goal: "Цель работы.", content: "Содержание работы." },
    };
    fetchMock.mockResolvedValueOnce(
      answer(
        section({
          birthDate: "1990-04-24",
          kinds: kinds40,
          consentRequired: false,
          submissions: [complete],
        }),
      ),
    );
    render(<CongressSection host={HOST} />);
    const field = await screen.findByLabelText("Дата рождения");
    expect(field).toHaveValue("24.04.1990");
    await userEvent.clear(field);
    await userEvent.type(field, "25.04.1990");
    fetchMock.mockResolvedValueOnce(answer({ birthDate: "1990-04-25" }));
    await userEvent.tab();
    await waitFor(() => expect(callsTo("PUT")).toHaveLength(1));
    expect(
      JSON.parse(String((callsTo("PUT")[0]![1] as RequestInit).body)),
    ).toEqual({
      birthDate: "1990-04-25",
    });

    fetchMock.mockResolvedValueOnce(
      answer(
        { problems: [{ code: "field-invalid", field: "birthDate" }] },
        422,
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Да, отправить" }),
    );
    const summary = await screen.findByRole("alert");
    expect(
      within(summary).getByRole("button", { name: "Укажите дату рождения" }),
    ).toBeInTheDocument();
    expect(field).toHaveAttribute("aria-invalid", "true");
  });

  it("046 EARS-20: an over-limit holder sees the refusal on the poster card with no start; the other kinds stay available", async () => {
    fetchMock.mockResolvedValueOnce(
      answer(section({ birthDate: "1980-01-01", kinds: kinds40 })),
    );
    render(<CongressSection host={HOST} />);
    const pick = await screen.findByTestId("congress-pick-poster");
    expect(
      within(pick).getByText(
        "Постерные доклады принимают от участников младше 40 лет на дату начала Конгресса — 23 апреля 2027. На эту дату вам будет 47 лет.",
      ),
    ).toBeInTheDocument();
    expect(within(pick).queryByRole("button")).toBeNull();
    expect(
      within(screen.getByTestId("congress-pick-oral")).getByRole("button", {
        name: "Начать заявку →",
      }),
    ).toBeEnabled();
  });

  it("046 EARS-20: a birth date entered in the draft that reaches the limit shows the refusal in the send block, disables the send and stays correctable", async () => {
    openDraft(posterDraft.id);
    fetchMock.mockResolvedValueOnce(
      answer(
        section({
          kinds: kinds40,
          submissions: [{ ...posterDraft, title: "Постер" }],
        }),
      ),
    );
    render(<CongressSection host={HOST} />);
    const field = await screen.findByLabelText("Дата рождения");
    expect(screen.getByRole("button", { name: "Отправить" })).toBeEnabled();
    await userEvent.type(field, "23.04.1987");
    fetchMock.mockResolvedValueOnce(answer({ birthDate: "1987-04-23" }));
    await userEvent.tab();
    expect(
      await screen.findByText(
        "Постерные доклады принимают от участников младше 40 лет на дату начала Конгресса — 23 апреля 2027. На эту дату вам будет 40 лет.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Отправить" })).toBeDisabled();
    expect(screen.getByLabelText("Дата рождения")).toBeEnabled();
    expect(screen.getByLabelText("Дата рождения")).toHaveValue("23.04.1987");
  });

  it("046 EARS-20: a poster draft of an over-limit holder shows the refusal in the send block and no active send; the date stays correctable", async () => {
    openDraft(posterDraft.id);
    fetchMock.mockResolvedValueOnce(
      answer(
        section({
          birthDate: "1980-01-01",
          kinds: kinds40,
          submissions: [{ ...posterDraft, title: "Постер" }],
        }),
      ),
    );
    render(<CongressSection host={HOST} />);
    expect(
      await screen.findByText(
        "Постерные доклады принимают от участников младше 40 лет на дату начала Конгресса — 23 апреля 2027. На эту дату вам будет 47 лет.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Отправить" })).toBeDisabled();
    expect(screen.queryByRole("textbox", { name: "Тема" })).toBeNull();
    expect(screen.getByLabelText("Дата рождения")).toHaveValue("01.01.1980");
  });

  it("046 EARS-20: in the list an age-locked poster draft reads «Открыть» with the age rule on its meta line", async () => {
    fetchMock.mockResolvedValueOnce(
      answer(
        section({
          birthDate: "1980-01-01",
          kinds: kinds40,
          submissions: [{ ...posterDraft, title: "Постер" }],
        }),
      ),
    );
    render(<CongressSection host={HOST} />);
    const row = (await screen.findAllByTestId("congress-row"))[0]!;
    expect(
      within(row).getByText(
        /^Постерный доклад · изменён .+ · постерные доклады принимают от участников младше 40 лет на дату начала конгресса$/,
      ),
    ).toBeInTheDocument();
    expect(
      within(row).getByRole("button", { name: "Открыть →" }),
    ).toBeEnabled();
    expect(
      within(row).queryByRole("button", { name: "Продолжить →" }),
    ).toBeNull();
  });

  it("046 EARS-19: the birth-date field is plain text — no numeric keypad that lacks «.»", async () => {
    openDraft(posterDraft.id);
    fetchMock.mockResolvedValueOnce(
      answer(section({ kinds: kinds40, submissions: [posterDraft] })),
    );
    render(<CongressSection host={HOST} />);
    const field = await screen.findByLabelText("Дата рождения");
    expect(field).not.toHaveAttribute("inputmode");
    expect(field).toHaveAttribute("autocomplete", "bday");
  });

  it("046 EARS-20: a send the API refuses for age shows its limit, day and age", async () => {
    openDraft(posterDraft.id);
    const complete = {
      ...posterDraft,
      title: "Постер",
      body: { goal: "Цель работы.", content: "Содержание работы." },
    };
    fetchMock.mockResolvedValueOnce(
      answer(
        section({
          birthDate: "1990-04-24",
          kinds: kinds40,
          consentRequired: false,
          submissions: [complete],
        }),
      ),
    );
    render(<CongressSection host={HOST} />);
    await screen.findByLabelText("Цель");
    fetchMock.mockResolvedValueOnce(
      answer(
        {
          problems: [
            {
              code: "age-limit",
              params: {
                maxAgeYears: 40,
                eventStartDate: "2027-04-23",
                age: 41,
              },
            },
          ],
        },
        422,
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Да, отправить" }),
    );
    expect(
      await screen.findByText(
        "Постерные доклады принимают от участников младше 40 лет на дату начала Конгресса — 23 апреля 2027. На эту дату вам будет 41 год.",
      ),
    ).toBeInTheDocument();
  });

  it("046 EARS-19: once a poster has been sent, a new poster draft does not ask for the birth date again", async () => {
    openDraft(posterDraft.id);
    fetchMock.mockResolvedValueOnce(
      answer(
        section({
          birthDate: "1990-04-24",
          kinds: kinds40,
          submissions: [
            posterDraft,
            sub({ id: "00000000-0000-4000-8000-0000000000a2", kind: "poster" }),
          ],
        }),
      ),
    );
    render(<CongressSection host={HOST} />);
    await screen.findByLabelText("Цель");
    expect(screen.queryByLabelText("Дата рождения")).toBeNull();
  });
});
