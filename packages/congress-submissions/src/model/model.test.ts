import {
  CONGRESS_SUBMISSION_PROBLEM_CODES,
  type CongressSubmission,
  type CongressSubmissionKindIntake,
} from "@ds/schemas";

import {
  actionsFor,
  closedText,
  countdownText,
  dateLine,
  draftErrors,
  editable,
  eventLine,
  intakeLine,
  kindStartable,
  limitLine,
  localDate,
  localDateTime,
  localTime,
  mskDate,
  mskDateTime,
  problemMessages,
  revisionView,
  rowMeta,
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

  it("EARS-11: after the deadline — expired, nothing to send", () => {
    const v = revisionView(
      sub({ status: "needs_revision", revisionDueAt: due }),
      new Date("2027-02-25T09:00:00.000Z"),
    );
    expect(v.open).toBe(false);
    expect(v.text).toBe(
      "Срок доработки истёк 22 декабря, 23:59 МСК — отправить заявку нельзя",
    );
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
      "Устный доклад · изменён 18 декабря 2026",
    );
    expect(rowMeta(sub({ status: "submitted" }), intake(), NOW)).toBe(
      "Устный доклад · изменено 18 декабря 2026 · рассмотрит программный комитет, ответ придёт на почту",
    );
    expect(rowMeta(sub(), intake({ state: "closed" }), NOW)).toBe(
      "Устный доклад · изменён 18 декабря 2026 · приём устных докладов закрыт 15 января 2027",
    );
  });

  it("EARS-11: the change, send and withdrawal times are the viewer's, not Moscow", () => {
    const late = "2026-12-18T20:00:00.000Z"; // 23:00 МСК, 06:00 19 Dec local
    expect(rowMeta(sub({ updatedAt: late }), intake(), NOW)).toBe(
      "Устный доклад · изменён 19 декабря 2026",
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
    );
    expect(msgs.map((m) => m.message)).toEqual([
      "Срок доработки истёк 22 декабря, 23:59 МСК — отправить заявку нельзя",
    ]);
  });

  it("046 EARS-9: every refusal code the API can return reads as a visible message — none is dropped", () => {
    for (const code of CONGRESS_SUBMISSION_PROBLEM_CODES) {
      const field = code === "field-invalid" ? "body.unknown" : undefined;
      const msgs = problemMessages(
        [{ code, ...(field ? { field } : {}) }],
        intake(),
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
    );
    expect(msgs.map((m) => m.message)).toEqual([
      "Можно отправить не больше 3 устных докладов",
      "Приём устных докладов закрыт 15 января 2027 — отправить заявку нельзя",
      "Укажите тему",
    ]);
  });
});

describe("kind choice", () => {
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
