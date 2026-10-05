import {
  CONGRESS_SUBMISSION_PROBLEM_CODES,
  type CongressSubmission,
  type CongressSubmissionKindIntake,
} from "@ds/schemas";

import {
  abstractCounter,
  actionsFor,
  ageRefusalOf,
  ageRuleText,
  agoText,
  birthHint,
  closedText,
  confirmText,
  countdownText,
  dateLine,
  draftErrors,
  editable,
  eventLine,
  eventStartDay,
  formFields,
  intakeLine,
  kindStartable,
  limitLine,
  localDate,
  localDateTime,
  localTime,
  mskDate,
  mskDateTime,
  readBirthDate,
  withSubmissions,
  problemMessages,
  revisionView,
  pickerNote,
  rowMeta,
  takeBackHint,
  withdrawnNotice,
} from "./model";

// The package's test runtime zone is Vladivostok (UTC+10, `vitest.setup.ts`),
// deliberately NOT Moscow: a user-action timestamp must follow the viewer's
// zone while every rule date (intake, revision deadline) stays pinned to МСК.

const NOW = new Date("2026-12-20T11:32:00.000Z"); // 14:32 МСК

function intake(
  over: Partial<CongressSubmissionKindIntake> = {},
): CongressSubmissionKindIntake {
  return {
    kind: "oral",
    state: "open",
    opensAt: "2026-11-01T21:00:00.000Z",
    closesAt: "2027-01-15T21:00:00.000Z",
    lastDay: "2027-01-15",
    submitLimit: null,
    used: 0,
    offered: true,
    maxAgeYears: null,
    ...over,
  };
}

function sub(over: Partial<CongressSubmission> = {}): CongressSubmission {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    eventId: "00000000-0000-4000-8000-000000000002",
    kind: "oral",
    status: "draft",
    title: "",
    authors: [],
    body: {},
    derivedFromId: null,
    statements: null,
    committeeComment: null,
    submittedAt: null,
    revisionDueAt: null,
    statusChangedAt: "2026-12-18T09:00:00.000Z",
    updatedAt: "2026-12-18T09:00:00.000Z",
    createdAt: "2026-12-18T09:00:00.000Z",
    ...over,
  };
}

describe("dates in Moscow time", () => {
  it("EARS-11: formats a day and a day with time in Moscow", () => {
    expect(mskDate("2026-12-16T15:40:00.000Z")).toBe("16 декабря 2026");
    expect(mskDateTime("2026-12-16T15:40:00.000Z")).toBe(
      "16 декабря 2026, 18:40",
    );
  });

  it("EARS-4: the heading names the event and its days", () => {
    expect(
      eventLine({
        slug: "c",
        title: "VIII конгресс «Ортобиология»",
        startsAt: "2027-04-23T06:00:00.000Z",
        endsAt: "2027-04-24T15:00:00.000Z",
      }),
    ).toBe("VIII конгресс «Ортобиология» · 23–24 апреля 2027");
    expect(
      eventLine({
        slug: "c",
        title: "Конгресс",
        startsAt: "2027-04-23T06:00:00.000Z",
        endsAt: "2027-04-23T15:00:00.000Z",
      }),
    ).toBe("Конгресс · 23 апреля 2027");
  });
});

describe("user-action timestamps in the viewer's zone", () => {
  it("EARS-11: a day, a day with time and a time follow the browser zone", () => {
    expect(localDate("2026-12-16T15:40:00.000Z")).toBe("17 декабря 2026");
    expect(localDateTime("2026-12-16T15:40:00.000Z")).toBe(
      "17 декабря 2026, 01:40",
    );
    expect(localTime(new Date("2026-12-16T15:40:00.000Z"))).toBe("01:40");
  });
});

describe("kind intake lines", () => {
  it("EARS-10: the four intake states read as the canvas lines", () => {
    expect(intakeLine(intake())).toBe("Приём до 15 января 2027 включительно");
    expect(intakeLine(intake({ state: "closed" }))).toBe(
      "Приём закрыт 15 января 2027",
    );
    expect(intakeLine(intake({ state: "not-announced", opensAt: null }))).toBe(
      "Дату открытия приёма объявят позже",
    );
    expect(
      intakeLine(
        intake({ state: "not-yet-open", opensAt: "2026-11-30T21:00:00.000Z" }),
      ),
    ).toBe("Приём откроется 1 декабря 2026");
  });

  it("EARS-10: a draft whose kind is not open says why it cannot be sent", () => {
    expect(closedText(intake({ state: "closed" }))).toBe(
      "Приём устных докладов закрыт 15 января 2027 — отправить заявку нельзя",
    );
    expect(closedText(intake({ state: "not-announced", opensAt: null }))).toBe(
      "Дату открытия приёма устных докладов объявят позже — черновик сохранится",
    );
    expect(
      closedText(
        intake({ state: "not-yet-open", opensAt: "2026-11-30T21:00:00.000Z" }),
      ),
    ).toBe(
      "Приём устных докладов откроется 1 декабря 2026 — черновик сохранится",
    );
  });
});

describe("revision deadline", () => {
  const due = "2026-12-22T21:00:00.000Z"; // 23 Dec 00:00 МСК, exclusive

  it("EARS-11: before the deadline — the date, 23:59 МСК and the countdown", () => {
    const v = revisionView(
      sub({ status: "needs_revision", revisionDueAt: due }),
      NOW,
    );
    expect(v).toEqual({
      open: true,
      urgent: true,
      text: "Исправить и отправить до 22 декабря, 23:59 МСК · осталось 2 дня 9 часов",
    });
  });

  it("046 EARS-11: after the deadline — expired, how long ago, nothing to send", () => {
    const v = revisionView(
      sub({ status: "needs_revision", revisionDueAt: due }),
      new Date("2027-02-25T09:00:00.000Z"),
    );
    expect(v.open).toBe(false);
    expect(v.text).toBe(
      "Срок доработки истёк 22 декабря, 23:59 МСК (64 дня назад) — отправить заявку нельзя",
    );
  });

  it("046 EARS-11: the elapsed part counts whole days from the deadline instant", () => {
    const after = (ms: number) =>
      revisionView(
        sub({ status: "needs_revision", revisionDueAt: due }),
        new Date(new Date(due).getTime() + ms),
      ).text;
    expect(after(3 * 86_400_000 + 5 * 3_600_000)).toBe(
      "Срок доработки истёк 22 декабря, 23:59 МСК (3 дня назад) — отправить заявку нельзя",
    );
    expect(after(5 * 3_600_000)).toBe(
      "Срок доработки истёк 22 декабря, 23:59 МСК (5 часов назад) — отправить заявку нельзя",
    );
    expect(after(0)).toBe(
      "Срок доработки истёк 22 декабря, 23:59 МСК (меньше часа назад) — отправить заявку нельзя",
    );
  });

  it("046 EARS-11: the elapsed part pluralises days and hours, floors, and says «меньше часа» under an hour", () => {
    const D = 86_400_000;
    const H = 3_600_000;
    expect(agoText(1 * D)).toBe("1 день назад");
    expect(agoText(2 * D)).toBe("2 дня назад");
    expect(agoText(5 * D)).toBe("5 дней назад");
    expect(agoText(11 * D)).toBe("11 дней назад");
    expect(agoText(21 * D)).toBe("21 день назад");
    expect(agoText(2 * D - 1)).toBe("1 день назад");
    expect(agoText(1 * H)).toBe("1 час назад");
    expect(agoText(2 * H)).toBe("2 часа назад");
    expect(agoText(5 * H)).toBe("5 часов назад");
    expect(agoText(D - 1)).toBe("23 часа назад");
    expect(agoText(H - 1)).toBe("меньше часа назад");
    expect(agoText(0)).toBe("меньше часа назад");
  });

  it("EARS-11: the countdown pluralises days, hours and minutes", () => {
    expect(countdownText(5 * 86_400_000)).toBe("5 дней");
    expect(countdownText(86_400_000 + 3_600_000)).toBe("1 день 1 час");
    expect(countdownText(2 * 3_600_000 + 21 * 60_000)).toBe("2 часа 21 минута");
  });
});

describe("actions per status", () => {
  it("EARS-13: a draft continues and may be deleted", () => {
    const a = actionsFor(sub(), intake(), NOW);
    expect(a.primary).toEqual({ action: "open", label: "Продолжить" });
    expect(a.secondary).toEqual([
      { action: "delete", label: "Удалить черновик", danger: true },
    ]);
  });

  it("EARS-10: a draft of a closed kind only opens", () => {
    const a = actionsFor(sub(), intake({ state: "closed" }), NOW);
    expect(a.primary).toEqual({ action: "open", label: "Открыть" });
  });

  it("EARS-12: a submitted submission is taken back while the kind is open, withdrawn after", () => {
    const open = actionsFor(sub({ status: "submitted" }), intake(), NOW);
    expect(open.primary).toEqual({
      action: "take-back",
      label: "Забрать на исправление",
    });
    expect(open.secondary).toEqual([]);
    const closed = actionsFor(
      sub({ status: "submitted" }),
      intake({ state: "closed" }),
      NOW,
    );
    expect(closed.primary).toEqual({ action: "open", label: "Открыть" });
    expect(closed.secondary).toEqual([
      { action: "withdraw", label: "Отозвать", danger: true },
    ]);
  });

  it("046 EARS-12: the send confirm dates the take-back by the kind's close day", () => {
    expect(confirmText(sub(), intake())).toBe(
      "После отправки редактирование закроется. До 15 января 2027 заявку можно забрать на исправление. После — комитет рассмотрит отправленную версию.",
    );
    const again = sub({
      status: "needs_revision",
      revisionDueAt: "2026-12-22T21:00:00.000Z",
    });
    expect(
      confirmText(again, intake({ kind: "poster", lastDay: "2027-01-29" })),
    ).toBe(
      "До 29 января 2027 заявку можно забрать на исправление. После — комитет рассмотрит отправленную версию.",
    );
    expect(confirmText(again, intake({ state: "closed" }))).toBe(
      "После отправки изменить её будет нельзя — комитет рассмотрит эту версию.",
    );
  });

  it("046 EARS-12: a sent submission says until when it can be taken back, only while the kind is open", () => {
    expect(takeBackHint(sub({ status: "submitted" }), intake())).toBe(
      "Можно исправить до 15 января 2027",
    );
    expect(
      takeBackHint(sub({ status: "submitted" }), intake({ state: "closed" })),
    ).toBeNull();
    for (const status of [
      "draft",
      "in_review",
      "needs_revision",
      "accepted",
      "rejected",
      "withdrawn",
    ] as const) {
      expect(takeBackHint(sub({ status }), intake())).toBeNull();
    }
  });

  it("EARS-12: in review and needs revision may be withdrawn; decided and withdrawn may not", () => {
    for (const status of ["in_review", "needs_revision"] as const) {
      expect(
        actionsFor(
          sub({ status, revisionDueAt: "2026-12-22T21:00:00.000Z" }),
          intake(),
          NOW,
        ).secondary.map((s) => s.action),
      ).toEqual(["withdraw"]);
    }
    for (const status of ["accepted", "rejected"] as const) {
      expect(actionsFor(sub({ status }), intake(), NOW).secondary).toEqual([]);
    }
    const wd = actionsFor(sub({ status: "withdrawn" }), intake(), NOW);
    expect(wd.primary).toBeNull();
    expect(wd.secondary).toEqual([]);
  });

  it("EARS-7: a draft stays editable until its kind closes; a revision until its deadline", () => {
    expect(editable(sub(), intake(), NOW)).toBe(true);
    expect(editable(sub(), intake({ state: "not-yet-open" }), NOW)).toBe(true);
    expect(
      editable(
        sub(),
        intake({
          state: "not-announced",
          opensAt: null,
          closesAt: null,
          lastDay: null,
        }),
        NOW,
      ),
    ).toBe(true);
    expect(editable(sub(), intake({ state: "closed" }), NOW)).toBe(false);
    expect(editable(sub(), intake({ offered: false }), NOW)).toBe(false);
    expect(editable(sub({ status: "submitted" }), intake(), NOW)).toBe(false);
    expect(
      editable(
        sub({
          status: "needs_revision",
          revisionDueAt: "2026-12-22T21:00:00.000Z",
        }),
        intake({ state: "closed" }),
        NOW,
      ),
    ).toBe(true);
  });
});

describe("row meta and date line", () => {
  it("EARS-11: kind, last change, and the sent note", () => {
    expect(rowMeta(sub(), intake(), NOW)).toBe(
      "Устный доклад · изменено 18 декабря 2026",
    );
    expect(rowMeta(sub(), intake({ state: "closed" }), NOW)).toBe(
      "Устный доклад · изменено 18 декабря 2026 · приём устных докладов закрыт 15 января 2027",
    );
  });

  it("046 EARS-11: one neuter form for every kind — a draft row «изменено {date}», a sent row the send date «отправлено {date}», a withdrawn row «отозвано {date}»", () => {
    // Sent on the 16th, touched again on the 18th (a status move): the row
    // names the send, in the words of the detail line.
    const sent = sub({
      status: "submitted",
      submittedAt: "2026-12-16T09:00:00.000Z",
      updatedAt: "2026-12-18T09:00:00.000Z",
    });
    expect(rowMeta(sent, intake(), NOW)).toBe(
      "Устный доклад · отправлено 16 декабря 2026 · рассмотрит программный комитет, ответ придёт на почту",
    );
    expect(rowMeta({ ...sent, status: "in_review" }, intake(), NOW)).toBe(
      "Устный доклад · отправлено 16 декабря 2026",
    );
    expect(
      rowMeta(
        {
          ...sent,
          status: "withdrawn",
          statusChangedAt: "2026-12-19T09:00:00.000Z",
        },
        intake(),
        NOW,
      ),
    ).toBe("Устный доклад · отозвано 19 декабря 2026");
    expect(rowMeta(sub(), intake(), NOW)).toBe(
      "Устный доклад · изменено 18 декабря 2026",
    );
    // One neuter form for every kind (owner, Stage-B 2026-10-05): the row
    // reads «<Kind> · отправлено / изменено / отозвано {date}».
    for (const k of ["oral", "poster", "abstract"] as const) {
      expect(rowMeta(sub({ kind: k }), intake({ kind: k }), NOW)).toMatch(
        / · изменено 18 декабря 2026$/,
      );
      expect(
        rowMeta(
          { ...sent, kind: k, status: "in_review" },
          intake({ kind: k }),
          NOW,
        ),
      ).toMatch(/ · отправлено 16 декабря 2026$/);
    }
  });

  it("046 EARS-20: an age-locked poster draft row reads «Открыть» and carries the lower-cased age rule (canvas `draftClosed`)", () => {
    const refusal =
      "Постерные доклады принимают от участников младше 40 лет на дату начала Конгресса — 23 апреля 2027. На эту дату вам будет 47 лет.";
    const poster = sub({ kind: "poster" });
    const open = intake({ kind: "poster", maxAgeYears: 40 });
    expect(actionsFor(poster, open, NOW, refusal).primary).toEqual({
      action: "open",
      label: "Открыть",
    });
    expect(actionsFor(poster, open, NOW).primary?.label).toBe("Продолжить");
    expect(rowMeta(poster, open, NOW, refusal)).toBe(
      "Постерный доклад · изменено 18 декабря 2026 · постерные доклады принимают от участников младше 40 лет на дату начала конгресса",
    );
    // A sent poster keeps its own meta — the age lock speaks only for drafts.
    expect(
      rowMeta(
        sub({
          kind: "poster",
          status: "submitted",
          submittedAt: "2026-12-18T09:00:00.000Z",
        }),
        open,
        NOW,
        refusal,
      ),
    ).toBe(
      "Постерный доклад · отправлено 18 декабря 2026 · рассмотрит программный комитет, ответ придёт на почту",
    );
  });

  it("EARS-11: the change, send and withdrawal times are the viewer's, not Moscow", () => {
    const late = "2026-12-18T20:00:00.000Z"; // 23:00 МСК, 06:00 19 Dec local
    expect(rowMeta(sub({ updatedAt: late }), intake(), NOW)).toBe(
      "Устный доклад · изменено 19 декабря 2026",
    );
    expect(dateLine(sub({ updatedAt: late }))).toBe(
      "черновик изменён 19 декабря 2026",
    );
    // The withdrawal date is the status moment, not the last edit.
    const withdrawn = sub({
      status: "withdrawn",
      statusChangedAt: late,
      updatedAt: "2026-12-10T09:00:00.000Z",
    });
    expect(dateLine(withdrawn)).toBe("отозвана 19 декабря 2026");
    expect(withdrawnNotice(withdrawn)).toMatch(
      /^Заявка отозвана 19 декабря 2026\. /,
    );
    expect(dateLine(sub({ status: "submitted", submittedAt: late }))).toBe(
      "отправлена 19 декабря 2026, 06:00",
    );
  });

  it("EARS-11: the detail date line", () => {
    expect(dateLine(sub())).toBe("черновик изменён 18 декабря 2026");
    expect(
      dateLine(
        sub({ status: "submitted", submittedAt: "2026-12-16T15:40:00.000Z" }),
      ),
    ).toBe("отправлена 17 декабря 2026, 01:40");
    expect(dateLine(sub({ status: "withdrawn" }))).toBe(
      "отозвана 18 декабря 2026",
    );
  });
});

describe("046 EARS-10 — the chooser note names the concrete deadlines", () => {
  const prod = [
    intake({ kind: "oral", lastDay: "2027-01-15" }),
    intake({ kind: "poster", lastDay: "2027-01-29" }),
    intake({ kind: "abstract", lastDay: "2027-01-29", submitLimit: 3 }),
  ];

  it("046 EARS-10: the production settings read the owner-approved note exactly", () => {
    expect(pickerNote(prod)).toBe(
      "Устные доклады принимаются до 15 января 2027, постерные доклады и тезисы — до 29 января 2027 включительно. Докладов и постеров — сколько угодно, тезисов — не больше 3.",
    );
  });

  it("046 EARS-10: kinds sharing a last day are grouped; three distinct days are three clauses", () => {
    expect(pickerNote(prod.map((k) => ({ ...k, lastDay: "2027-01-29" })))).toBe(
      "Устные и постерные доклады и тезисы принимаются до 29 января 2027 включительно. Докладов и постеров — сколько угодно, тезисов — не больше 3.",
    );
    expect(
      pickerNote([prod[0]!, { ...prod[1]!, lastDay: "2027-01-22" }, prod[2]!]),
    ).toBe(
      "Устные доклады принимаются до 15 января 2027, постерные доклады — до 22 января 2027, тезисы — до 29 января 2027 включительно. Докладов и постеров — сколько угодно, тезисов — не больше 3.",
    );
  });

  it("046 EARS-10: talks and posters sharing a window read «Устные и постерные доклады» — «доклады» is not repeated", () => {
    expect(
      pickerNote([prod[0]!, { ...prod[1]!, lastDay: "2027-01-15" }, prod[2]!]),
    ).toBe(
      "Устные и постерные доклады принимаются до 15 января 2027, тезисы — до 29 января 2027 включительно. Докладов и постеров — сколько угодно, тезисов — не больше 3.",
    );
    expect(
      pickerNote([
        { ...prod[0]!, lastDay: "2027-01-29" },
        { ...prod[1]!, lastDay: "2027-01-15" },
        prod[2]!,
      ]),
    ).toBe(
      "Устные доклады и тезисы принимаются до 29 января 2027, постерные доклады — до 15 января 2027 включительно. Докладов и постеров — сколько угодно, тезисов — не больше 3.",
    );
  });

  it("046 EARS-10: a kind not yet open reads «приём откроется {date}» as on its card", () => {
    expect(
      pickerNote([
        prod[0]!,
        prod[1]!,
        {
          ...prod[2]!,
          state: "not-yet-open",
          opensAt: "2027-01-09T21:00:00.000Z",
        },
      ]),
    ).toBe(
      "Устные доклады принимаются до 15 января 2027, постерные доклады — до 29 января 2027 включительно, тезисы — приём откроется 10 января 2027. Докладов и постеров — сколько угодно, тезисов — не больше 3.",
    );
  });

  it("046 EARS-10: with no abstract limit the «тезисов — не больше N» clause is left out", () => {
    const note = pickerNote(prod.map((k) => ({ ...k, submitLimit: null })));
    expect(note).toBe(
      "Устные доклады принимаются до 15 января 2027, постерные доклады и тезисы — до 29 января 2027 включительно. Докладов и постеров — сколько угодно.",
    );
  });

  it("046 EARS-10: no «пока приём открыт» anywhere; a kind not offered is not named", () => {
    expect(pickerNote(prod)).not.toContain("пока приём открыт");
    expect(
      pickerNote([prod[0]!, { ...prod[1]!, offered: false }, prod[2]!]),
    ).toBe(
      "Устные доклады принимаются до 15 января 2027, тезисы — до 29 января 2027 включительно. Докладов и постеров — сколько угодно, тезисов — не больше 3.",
    );
  });
});

describe("send checks", () => {
  it("EARS-8: an empty oral draft names every unmet field, the consent included", () => {
    const errs = draftErrors(
      {
        title: "",
        authors: [{ surname: "", firstName: "", workplace: "" }],
        body: {},
      },
      { consentRequired: true, consentChecked: false },
    );
    expect(errs.map((e) => e.message)).toEqual([
      "Укажите тему",
      "Заполните фамилию, имя и место работы у каждого автора",
      "Заполните поле «Образовательная цель»",
      "Заполните поле «Краткое содержание»",
      "Дайте согласие на обработку персональных данных",
    ]);
  });

  it("EARS-8: exactly one presenting author", () => {
    const author = { surname: "Орлов", firstName: "Виктор", workplace: "ГКБ" };
    const errs = draftErrors(
      {
        title: "Тема",
        authors: [author, author],
        body: { goal: "g", summary: "s" },
      },
      { consentRequired: false, consentChecked: false },
    );
    expect(errs.map((e) => e.message)).toEqual(["Отметьте одного докладчика"]);
    // The DS error summary links it to the first «Докладчик» choice.
    expect(errs[0]!.focusId).toBe("in-a0-sp");
  });

  it("046 EARS-30: a resend refused after the revision deadline names it in the canvas words", () => {
    const msgs = problemMessages(
      [
        {
          code: "revision-closed",
          params: { revisionDueAt: "2026-12-22T21:00:00.000Z" },
        },
      ],
      intake(),
      new Date("2026-12-25T23:00:00.000Z"),
    );
    expect(msgs.map((m) => m.message)).toEqual([
      "Срок доработки истёк 22 декабря, 23:59 МСК (3 дня назад) — отправить заявку нельзя",
    ]);
  });

  it("046 EARS-11: a revision-closed refusal read on a clock behind the server's still reads as expired", () => {
    const msgs = problemMessages(
      [
        {
          code: "revision-closed",
          params: { revisionDueAt: "2026-12-22T21:00:00.000Z" },
        },
      ],
      intake(),
      new Date("2026-12-22T20:59:00.000Z"),
    );
    expect(msgs.map((m) => m.message)).toEqual([
      "Срок доработки истёк 22 декабря, 23:59 МСК (меньше часа назад) — отправить заявку нельзя",
    ]);
  });

  it("046 EARS-9: every refusal code the API can return reads as a visible message — none is dropped", () => {
    for (const code of CONGRESS_SUBMISSION_PROBLEM_CODES) {
      const field = code === "field-invalid" ? "body.unknown" : undefined;
      const msgs = problemMessages(
        [{ code, ...(field ? { field } : {}) }],
        intake(),
        NOW,
      );
      expect(msgs, code).toHaveLength(1);
      expect(msgs[0]!.message.length, code).toBeGreaterThan(0);
    }
  });

  it("EARS-17: a server refusal names the limit and the closed window", () => {
    const msgs = problemMessages(
      [
        { code: "limit-reached", params: { limit: 3 } },
        { code: "kind-closed" },
        { code: "field-invalid", field: "title" },
      ],
      intake({ state: "closed" }),
      NOW,
    );
    expect(msgs.map((m) => m.message)).toEqual([
      "Можно отправить не больше 3 устных докладов",
      "Приём устных докладов закрыт 15 января 2027 — отправить заявку нельзя",
      "Укажите тему",
    ]);
  });
});

describe("kind choice", () => {
  it("046 EARS-17: the section's per-kind count follows its submissions — every sent state counts, a draft does not", () => {
    const base = {
      kinds: [
        intake({ kind: "oral" }),
        intake({ kind: "abstract", submitLimit: 3, used: 0 }),
      ],
      submissions: [] as CongressSubmission[],
    };
    const next = withSubmissions(base, [
      sub({ id: "a1", kind: "abstract", status: "submitted" }),
      sub({ id: "a2", kind: "abstract", status: "withdrawn" }),
      sub({ id: "a3", kind: "abstract", status: "draft" }),
      sub({ id: "o1", kind: "oral", status: "needs_revision" }),
    ]);
    expect(next.kinds.map((k) => [k.kind, k.used])).toEqual([
      ["oral", 1],
      ["abstract", 2],
    ]);
    expect(next.submissions).toHaveLength(4);
  });

  it("EARS-6: a draft can be started until the kind closes, only for an offered kind", () => {
    expect(kindStartable(intake())).toBe(true);
    expect(kindStartable(intake({ state: "not-yet-open" }))).toBe(true);
    expect(kindStartable(intake({ state: "closed" }))).toBe(false);
    expect(kindStartable(intake({ kind: "poster", offered: false }))).toBe(
      false,
    );
  });

  it("EARS-17: a limited kind counts its sends and says when no more can be sent", () => {
    expect(limitLine(intake())).toBeNull();
    expect(limitLine(intake({ submitLimit: 3, used: 1 }))).toBe(
      "Отправлено 1 устный доклад из 3",
    );
    expect(limitLine(intake({ submitLimit: 5, used: 5 }))).toBe(
      "Отправлено 5 устных докладов из 5 — больше подать нельзя",
    );
    // 046 EARS-17 — the canvas line names the kind in its count form.
    expect(
      limitLine(intake({ kind: "abstract", submitLimit: 3, used: 3 })),
    ).toBe("Отправлено 3 тезиса из 3 — больше подать нельзя");
  });
});

describe("046 EARS-20 — the age-limit refusal in the owner-approved words", () => {
  const ageMsg = (maxAgeYears: number, age: number) =>
    problemMessages(
      [
        {
          code: "age-limit",
          params: { maxAgeYears, eventStartDate: "2027-04-23", age },
        },
      ],
      intake({ kind: "poster" }),
      NOW,
    ).map((m) => m.message);

  it("046 EARS-20: names the limit, the event's Moscow start day without a zone label and the age, each with an agreeing plural", () => {
    expect(ageMsg(40, 40)).toEqual([
      "Постерные доклады принимают от участников младше 40 лет на дату начала Конгресса — 23 апреля 2027. На эту дату вам будет 40 лет.",
    ]);
    expect(ageMsg(21, 45)).toEqual([
      "Постерные доклады принимают от участников младше 21 года на дату начала Конгресса — 23 апреля 2027. На эту дату вам будет 45 лет.",
    ]);
    expect(ageMsg(41, 42)[0]).toContain("младше 41 года");
    expect(ageMsg(41, 42)[0]).toContain("вам будет 42 года.");
    expect(ageMsg(40, 51)[0]).toContain("вам будет 51 год.");
    expect(ageMsg(40, 1)[0]).toContain("вам будет 1 год.");
    expect(ageMsg(40, 2)[0]).toContain("вам будет 2 года.");
    expect(ageMsg(40, 5)[0]).toContain("вам будет 5 лет.");
    expect(ageMsg(40, 21)[0]).toContain("вам будет 21 год.");
  });

  it("046 EARS-20: without its params the refusal keeps the generic line", () => {
    const msgs = problemMessages([{ code: "age-limit" }], intake(), NOW);
    expect(msgs.map((m) => m.message)).toEqual([
      "Возраст первого автора не подходит под условия этого вида заявок",
    ]);
  });
});

describe("046 EARS-18 — the poster form", () => {
  it("046 EARS-18: a poster asks for «Цель» and «Содержание» within their limits, an oral talk keeps its own pair", () => {
    expect(formFields("poster").map((f) => [f.key, f.label, f.max])).toEqual([
      ["goal", "Цель", 1000],
      ["content", "Содержание", 3000],
    ]);
    expect(formFields("oral").map((f) => [f.key, f.label, f.max])).toEqual([
      ["goal", "Образовательная цель", 1000],
      ["summary", "Краткое содержание", 3000],
    ]);
  });

  it("046 EARS-18: an empty poster draft names its own fields; the birth date the flow asks for comes after the authors", () => {
    const errs = draftErrors(
      {
        title: "",
        authors: [{ surname: "", firstName: "", workplace: "" }],
        body: {},
      },
      { consentRequired: false, consentChecked: false },
      { kind: "poster", birthValue: "", today: "2026-12-20" },
    );
    expect(errs.map((e) => [e.key, e.message, e.focusId])).toEqual([
      ["title", "Укажите тему", "in-topic"],
      [
        "authors",
        "Заполните фамилию, имя и место работы у каждого автора",
        "in-a0-sn",
      ],
      ["birth", "Укажите дату рождения", "in-birth"],
      ["goal", "Заполните поле «Цель»", "in-goal"],
      ["content", "Заполните поле «Содержание»", "in-content"],
    ]);
  });

  it("046 EARS-18: a poster has no presenting mark — unmarked authors pass, and a refused author list never asks for a speaker", () => {
    const complete = {
      title: "Тема",
      authors: [
        { surname: "Петрова", firstName: "Анна", workplace: "НМИЦ" },
        { surname: "Иванов", firstName: "Пётр", workplace: "НМИЦ" },
      ],
      body: { goal: "Цель", content: "Содержание" },
    };
    const consent = { consentRequired: false, consentChecked: false };
    expect(draftErrors(complete, consent, { kind: "poster" })).toEqual([]);
    expect(
      draftErrors(
        { ...complete, body: { goal: "Цель", summary: "Сводка" } },
        consent,
        { kind: "oral" },
      ).map((e) => e.message),
    ).toEqual(["Отметьте одного докладчика"]);
    expect(
      problemMessages(
        [{ code: "field-invalid", field: "authors" }],
        intake({ kind: "poster" }),
        NOW,
      ).map((e) => e.message),
    ).toEqual(["Заполните фамилию, имя и место работы у каждого автора"]);
  });

  it("046 EARS-18: a refused poster field is named by its own label", () => {
    const msgs = problemMessages(
      [{ code: "field-invalid", field: "body.content" }],
      intake({ kind: "poster" }),
      NOW,
    );
    expect(msgs).toEqual([
      {
        key: "content",
        message: "Заполните поле «Содержание»",
        focusId: "in-content",
      },
    ]);
  });
});

describe("046 EARS-21…EARS-25 — abstracts", () => {
  const sections = {
    relevance: "Актуальность.",
    goal: "Цель.",
    methods: "Методы.",
    results: "Результаты.",
    conclusions: "Выводы.",
  };
  const author = { surname: "Петрова", firstName: "Анна", workplace: "НМИЦ" };
  const noConsent = { consentRequired: false, consentChecked: false };

  it("046 EARS-21: abstracts ask for the five canvas sections, each within the whole total", () => {
    expect(
      formFields("abstract").map((f) => [f.key, f.label, f.rows, f.max]),
    ).toEqual([
      ["relevance", "Актуальность", 3, 5000],
      ["goal", "Цель", 2, 5000],
      ["methods", "Материалы и методы", 4, 5000],
      ["results", "Результаты и обсуждение", 4, 5000],
      ["conclusions", "Выводы", 3, 5000],
    ]);
  });

  it("046 EARS-22: the one total counter reads the server's length, marked near and above 5000 as the canvas draws it", () => {
    const ru = (n: number) => n.toLocaleString("ru-RU");
    expect(abstractCounter({ relevance: " ab\r\nc " })).toEqual({
      length: 4,
      text: "4 / 5 000",
      over: false,
      near: false,
      note: null,
    });
    expect(abstractCounter({ results: "р".repeat(4500) })).toEqual({
      length: 4500,
      text: `${ru(4500)} / 5 000`,
      over: false,
      near: true,
      note: `осталось ${ru(500)}`,
    });
    expect(abstractCounter({ results: "р".repeat(5000) })).toMatchObject({
      over: false,
      near: true,
      note: "осталось 0",
    });
    expect(
      abstractCounter({
        relevance: "а".repeat(3000),
        results: "р".repeat(2001),
      }),
    ).toEqual({
      length: 5001,
      text: `${ru(5001)} / 5 000`,
      over: true,
      near: false,
      note: "больше на 1",
    });
  });

  it("046 EARS-21, EARS-23: an incomplete abstract names its empty sections, the length, then each statement, then the consent", () => {
    const errs = draftErrors(
      {
        title: "Тема",
        authors: [author],
        body: {
          ...sections,
          goal: " ",
          results: "р".repeat(5001),
        },
      },
      { consentRequired: true, consentChecked: false },
      { kind: "abstract", statements: ["trade"] },
    );
    expect(errs.map((e) => [e.key, e.message, e.focusId])).toEqual([
      ["goal", "Заполните поле «Цель»", "in-goal"],
      [
        "counter",
        `Сократите текст тезисов до 5 000 знаков — сейчас ${(5001 + 13 + 7 + 7).toLocaleString("ru-RU")}`,
        "in-results",
      ],
      [
        "plag",
        "Подтвердите, что в тексте нет некорректных заимствований",
        "chk-plag",
      ],
      ["consent", "Дайте согласие на обработку персональных данных", "chk-pd"],
    ]);
    expect(
      draftErrors(
        { title: "Тема", authors: [author], body: sections },
        noConsent,
        { kind: "abstract", statements: ["plag", "trade"] },
      ),
    ).toEqual([]);
    // An oral talk asks for no statement.
    expect(
      draftErrors(
        {
          title: "Тема",
          authors: [{ ...author, presenting: true }],
          body: { goal: "g", summary: "s" },
        },
        noConsent,
        { kind: "oral" },
      ),
    ).toEqual([]);
  });

  it("046 EARS-21, EARS-23: the server's refusals read in the canvas words — the length with its count, each statement", () => {
    const msgs = problemMessages(
      [
        {
          code: "field-invalid",
          field: "body",
          params: { length: 5120, max: 5000 },
        },
        { code: "field-invalid", field: "body.conclusions" },
        { code: "statement-required", params: { statement: "plag" } },
        { code: "statement-required", params: { statement: "trade" } },
      ],
      intake({ kind: "abstract", submitLimit: 3 }),
      NOW,
    );
    expect(msgs.map((m) => [m.key, m.message, m.focusId])).toEqual([
      [
        "counter",
        `Сократите текст тезисов до 5 000 знаков — сейчас ${(5120).toLocaleString("ru-RU")}`,
        "in-results",
      ],
      ["conclusions", "Заполните поле «Выводы»", "in-conclusions"],
      [
        "plag",
        "Подтвердите, что в тексте нет некорректных заимствований",
        "chk-plag",
      ],
      [
        "trade",
        "Подтвердите, что в тексте нет торговых наименований",
        "chk-trade",
      ],
    ]);
  });

  it("046 EARS-17, EARS-24: the abstract limit names the number in the kind's plural; the first-author refusal names the author, the count and the limit", () => {
    const msgs = problemMessages(
      [
        { code: "limit-reached", params: { limit: 3 } },
        {
          code: "first-author-limit-reached",
          params: {
            limit: 3,
            used: 3,
            firstAuthor: "Иванова Мария Петровна",
          },
        },
      ],
      intake({ kind: "abstract", submitLimit: 3 }),
      NOW,
    );
    expect(msgs.map((m) => m.message)).toEqual([
      "Можно отправить не больше 3 тезисов",
      "С первым автором «Иванова Мария Петровна» уже отправлено 3 тезиса из 3 — эту заявку отправить нельзя.",
    ]);
    const five = problemMessages(
      [
        {
          code: "first-author-limit-reached",
          params: { limit: 5, used: 5, firstAuthor: "Орлов Виктор" },
        },
      ],
      intake({ kind: "abstract", submitLimit: 5 }),
      NOW,
    );
    expect(five[0]!.message).toBe(
      "С первым автором «Орлов Виктор» уже отправлено 5 тезисов из 5 — эту заявку отправить нельзя.",
    );
  });

  it("046 EARS-25: «Подать тезисы по этой работе» sits on a sent talk or poster while abstracts can be started — never on a draft, a withdrawn one or an abstract", () => {
    const abstracts = intake({ kind: "abstract", submitLimit: 3 });
    const labels = (s: Parameters<typeof actionsFor>[0], a = abstracts) =>
      actionsFor(s, intake(), NOW, null, a).secondary.map((x) => x.label);
    expect(labels(sub({ status: "submitted" }))).toEqual([
      "Подать тезисы по этой работе",
    ]);
    expect(labels(sub({ status: "accepted" }))).toEqual([
      "Подать тезисы по этой работе",
    ]);
    expect(labels(sub({ status: "in_review", kind: "poster" }))).toEqual([
      "Подать тезисы по этой работе",
      "Отозвать",
    ]);
    expect(labels(sub({ status: "draft" }))).not.toContain(
      "Подать тезисы по этой работе",
    );
    expect(labels(sub({ status: "withdrawn" }))).toEqual([]);
    expect(labels(sub({ status: "submitted", kind: "abstract" }))).toEqual([]);
    expect(
      labels(sub({ status: "submitted" }), { ...abstracts, state: "closed" }),
    ).toEqual([]);
    expect(
      actionsFor(sub({ status: "submitted" }), intake(), NOW).secondary,
    ).toEqual([]);
  });
});

describe("046 EARS-19 — the birth date", () => {
  it("046 EARS-19: the date control's value counts only as a real day from 1900 up to today in Moscow", () => {
    const today = "2026-12-20";
    expect(readBirthDate("1987-04-24", today)).toBe("1987-04-24");
    expect(readBirthDate("2026-12-20", today)).toBe("2026-12-20");
    expect(readBirthDate("1900-01-01", today)).toBe("1900-01-01");
    expect(readBirthDate("", today)).toBeNull();
    expect(readBirthDate("1899-12-31", today)).toBeNull();
    expect(readBirthDate("2026-12-21", today)).toBeNull();
    expect(readBirthDate("1990-02-31", today)).toBeNull();
    // The native date control hands over ISO only — typed text never parses.
    expect(readBirthDate("24.04.1987", today)).toBeNull();
    expect(readBirthDate("1010122111122", today)).toBeNull();
  });

  it("046 EARS-19: a refusal on `birthDate` sits next to the birth-date field", () => {
    const msgs = problemMessages(
      [{ code: "field-invalid", field: "birthDate" }],
      intake({ kind: "poster" }),
      NOW,
    );
    expect(msgs).toEqual([
      { key: "birth", message: "Укажите дату рождения", focusId: "in-birth" },
    ]);
  });

  it("046 EARS-19: the hint says it is asked once and states the kind's age rule when it has one", () => {
    const start = "2027-04-23";
    expect(birthHint(intake({ kind: "poster", maxAgeYears: 40 }), start)).toBe(
      "Спрашиваем один раз — перед первым постером. Постерные доклады принимают от участников младше 40 лет на дату начала Конгресса — 23 апреля 2027.",
    );
    expect(birthHint(intake({ kind: "poster" }), start)).toBe(
      "Спрашиваем один раз — перед первым постером.",
    );
  });
});

describe("046 EARS-20 — the age rule in the cabinet", () => {
  const event = {
    slug: "orthobio-2027",
    title: "VIII конгресс «Ортобиология»",
    // 02:30 МСК on 23 April, still the 22nd in UTC.
    startsAt: "2027-04-22T23:30:00.000Z",
    endsAt: "2027-04-24T15:00:00.000Z",
  };

  it("046 EARS-20: the event's start day is its Moscow calendar day", () => {
    expect(eventStartDay(event)).toBe("2027-04-23");
  });

  it("046 EARS-20: the holder at or above the limit on the start day is refused with the limit, the day and the age", () => {
    const poster = intake({ kind: "poster", maxAgeYears: 40 });
    expect(ageRefusalOf(poster, "1987-04-23", "2027-04-23")).toEqual({
      maxAgeYears: 40,
      eventStartDate: "2027-04-23",
      age: 40,
    });
    expect(ageRefusalOf(poster, "1987-04-24", "2027-04-23")).toBeNull();
    expect(ageRefusalOf(poster, null, "2027-04-23")).toBeNull();
    expect(
      ageRefusalOf(intake({ kind: "oral" }), "1950-01-01", "2027-04-23"),
    ).toBeNull();
  });

  it("046 EARS-20: the rule line is the refusal without the age", () => {
    expect(ageRuleText({ maxAgeYears: 40, eventStartDate: "2027-04-23" })).toBe(
      "Постерные доклады принимают от участников младше 40 лет на дату начала Конгресса — 23 апреля 2027",
    );
  });
});
