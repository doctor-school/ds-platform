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

function section(over: Partial<CongressSubmissionSection> = {}): CongressSubmissionSection {
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
    expect(await screen.findByRole("heading", { level: 1, name: "Мои заявки на Конгресс" })).toBeInTheDocument();
    expect(screen.getByText("VIII конгресс «Ортобиология» · 23–24 апреля 2027")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Аккаунт" })).toHaveAttribute("href", "/account");
    expect(screen.getByRole("link", { name: "Страница Конгресса ↗" })).toHaveAttribute(
      "href",
      "/events/orthobio-2027",
    );
    // The host shell owns the page's one `main` landmark (V-18 axe: no nested main).
    expect(screen.queryByRole("main")).toBeNull();
  });

  it("EARS-5: without a registration only the line and the registration link show", async () => {
    fetchMock.mockResolvedValue(answer(section({ registered: false })));
    render(<CongressSection host={HOST} />);
    expect(await screen.findByText("Сначала зарегистрируйтесь участником Конгресса")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Регистрация на сайте Конгресса ↗" })).toHaveAttribute(
      "href",
      "https://orthobio.ru/#join",
    );
    expect(screen.queryByText("Новая заявка")).not.toBeInTheDocument();
  });

  it("EARS-4: a failed read says so and retries", async () => {
    fetchMock.mockResolvedValueOnce(answer({}, 503));
    fetchMock.mockResolvedValueOnce(answer(section({ submissions: [sub()] })));
    render(<CongressSection host={HOST} />);
    expect(await screen.findByText("Не удалось загрузить заявки")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(await screen.findByText("PRP при латеральном эпикондилите")).toBeInTheDocument();
  });

  it("EARS-4: a guest whose session is gone goes to the sign-in door", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign, search: "" });
    fetchMock.mockResolvedValue(answer({}, 401));
    render(<CongressSection host={HOST} />);
    await waitFor(() => expect(assign).toHaveBeenCalledWith(HOST.signInHref));
  });

  it("EARS-6: with no submissions the kind choice shows; only the oral talk can be started", async () => {
    fetchMock.mockResolvedValue(answer(section()));
    render(<CongressSection host={HOST} />);
    const oral = await screen.findByTestId("congress-pick-oral");
    expect(within(oral).getByText("Приём до 15 января 2027 включительно")).toBeInTheDocument();
    expect(within(oral).getByRole("button", { name: "Начать заявку →" })).toBeEnabled();
    expect(within(oral).getByRole("button", { name: "Начать заявку →" })).toHaveClass("text-sm");
    for (const k of ["poster", "abstract"]) {
      expect(within(screen.getByTestId(`congress-pick-${k}`)).queryByRole("button")).toBeNull();
    }
    expect(screen.getByText("Приём постерных докладов и тезисов откроется позже")).toBeInTheDocument();
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
    expect(within(rows[0]!).getByRole("button", { name: "Забрать на исправление →" })).toHaveClass(
      "text-sm",
    );
    expect(within(rows[1]!).getByText("Уточните дизайн исследования")).toBeInTheDocument();
    expect(within(rows[1]!).getByText(/^Исправить и отправить до .* · осталось/)).toBeInTheDocument();
    expect(within(rows[1]!).getByRole("button", { name: "Отозвать" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /На доработке/ }));
    expect(screen.getAllByTestId("congress-row")).toHaveLength(1);
  });

  it("EARS-7/9: the oral draft saves on blur; a send with gaps lists each one, the consent included", async () => {
    const draft = sub({
      status: "draft",
      title: "",
      submittedAt: null,
      authors: [{ surname: "Орлов", firstName: "Виктор", workplace: "ГКБ № 12", presenting: true }],
    });
    window.history.replaceState(null, "", `/account/congress?submission=${draft.id}`);
    fetchMock.mockResolvedValueOnce(answer(section({ submissions: [draft] })));
    render(<CongressSection host={HOST} />);
    const topic = await screen.findByLabelText("Тема");
    expect(screen.getByText("Формат участия — очный")).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(answer({ ...draft, title: "PRP" }));
    await userEvent.type(topic, "PRP");
    await userEvent.tab();
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === "PATCH")).toBe(true),
    );
    const patch = fetchMock.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === "PATCH")!;
    expect(JSON.parse(String((patch[1] as RequestInit).body))).toMatchObject({ title: "PRP" });

    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));
    const summary = await screen.findByRole("alert");
    expect(within(summary).getByText("Заявка не отправлена. Исправьте 3 ошибки:")).toBeInTheDocument();
    expect(within(summary).getByText("Заполните поле «Образовательная цель»")).toBeInTheDocument();
    expect(within(summary).getByText("Дайте согласие на обработку персональных данных")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "обработку персональных данных" })).toHaveAttribute(
      "href",
      "https://orthobio.ru/privacy",
    );
  });

  it("EARS-12: «Отозвать» asks first; confirming withdraws with the status the author saw", async () => {
    const inReview = sub({ status: "in_review" });
    fetchMock.mockResolvedValueOnce(answer(section({ submissions: [inReview] })));
    render(<CongressSection host={HOST} />);
    await userEvent.click(await screen.findByRole("button", { name: "Отозвать" }));
    expect(screen.getByText("Отозвать заявку? Комитет её не рассмотрит, вернуть будет нельзя.")).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(answer({ ...inReview, status: "withdrawn" }));
    const ask = screen.getByRole("group", { name: /Отозвать заявку\?/ });
    await userEvent.click(within(ask).getByRole("button", { name: "Отозвать" }));
    await screen.findByText("Отозвана");
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe(`/v1/me/congress-submissions/${inReview.id}/withdraw`);
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ expectedStatus: "in_review" });
  });
});
