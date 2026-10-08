import { describe, expect, it } from "vitest";
import {
  congressConfirmationMessage,
  congressSubmissionDecisionMessage,
  congressSubmissionReceiptMessage,
  endSentence,
  formatCongressEventDate,
  formatRevisionLastDay,
} from "./notice-emails.js";

/**
 * 044 EARS-13 — the confirmation-email COPY, pinned string by string.
 *
 * The owner decided (chat 2026-09-24, #2369) that the letter only confirms the
 * registration: ONE copy for every participant, no word about a Doctor.School
 * account and no sign-in action — a congress participant must not be told they
 * «landed» in a Doctor.School account. The spec records it as a production
 * amendment of EARS-13
 * (`apps/docs/content/specs/features/044-congress-signup/044-requirements-en.md`).
 *
 * Whole sentences are compared, and the removed wording is asserted ABSENT in
 * both the text and the HTML part, so a regression that re-introduces the
 * account paragraph or the «Войти» button fails here.
 */

/**
 * 046 «Letters» (owner 2026-10-06, #2634) — congress letters carry no link:
 * the way into the cabinet is told in text, naming the congress site's own
 * domain as plain text, never as an `<a href>` or a URL.
 */
const CONGRESS_SITE_DOMAIN = "orthobio.ru";

function expectNoLinkOnlyTheDomainAsText(message: {
  text: string;
  html: string;
}): void {
  expect(htmlLinks(message.html)).toEqual([]);
  expect(message.html).not.toMatch(/href=/);
  for (const part of [message.text, message.html]) {
    expect(part).not.toMatch(/https?:\/\//);
    expect(part).not.toContain("/account/congress");
    expect(part).toContain(CONGRESS_SITE_DOMAIN);
  }
}

const CONTENT = {
  eventTitle: "Конгресс-2027",
  eventDate: "12 марта 2027 г. в 10:00",
  eventVenue: "Москва, Крокус Экспо",
} as const;

// «Войти» alone is not listed: the cabinet line names the congress site's
// «Войти в кабинет» button in text (#2634); the absence of any sign-in ACTION is
// proven by the no-link test below (046 EARS-15).
const REMOVED = ["аккаунт", "Пароль не нужен", "/login"] as const;

/** Every `<a href>` in the HTML part — the letter's actions. */
function htmlLinks(html: string): Array<{ url: string; label: string }> {
  return [...html.matchAll(/<a href="([^"]+)"[^>]*>(.*?)<\/a>/g)].map(
    ([, url, label]) => ({ url: url!, label: label! }),
  );
}

describe("044 EARS-13: the congress confirmation email", () => {
  it("044 EARS-13.1: the letter shall carry the approved subject, first line and footer as one copy", () => {
    const message = congressConfirmationMessage(CONTENT);

    expect(message.subject).toBe(
      "Doctor.School — вы зарегистрированы на Конгресс-2027",
    );
    expect(message.text).toContain(
      "Вы зарегистрированы на Конгресс-2027: 12 марта 2027 г. в 10:00, " +
        "Москва, Крокус Экспо.",
    );
    expect(message.text).toContain(
      "Если это были не вы, просто проигнорируйте это письмо.",
    );
    expect(message.text).toContain("Команда Doctor.School");
  });

  it("044 EARS-13.2: the letter shall carry no account paragraph and no sign-in action", () => {
    const message = congressConfirmationMessage(CONTENT);

    for (const removed of REMOVED) {
      expect(message.text).not.toContain(removed);
      expect(message.html).not.toContain(removed);
    }
  });

  it("044 EARS-13.3: the event instant shall render as Moscow wall-clock regardless of the server zone", () => {
    // 2027-03-12T07:00Z is 10:00 in Moscow (UTC+3, no DST since 2014).
    expect(formatCongressEventDate(new Date("2027-03-12T07:00:00.000Z"))).toBe(
      "12 марта 2027 г. в 10:00",
    );
  });

  it("046 EARS-15: the confirmation shall carry no link, no button and no URL in either part, naming the congress site only as text", () => {
    const message = congressConfirmationMessage(CONTENT);

    expectNoLinkOnlyTheDomainAsText(message);
    for (const part of [message.text, message.html]) {
      expect(part).not.toContain("Подать материалы в кабинете");
    }
  });
});

describe("046 EARS-14: the submission receipt", () => {
  const RECEIPT = {
    title: "Ранняя реабилитация после артроскопии",
    kindLabel: "Устный доклад",
    eventTitle: "Конгресс-2027",
  } as const;

  it("EARS-14: the receipt carries the approved subject, text and footer verbatim", () => {
    const message = congressSubmissionReceiptMessage(RECEIPT);

    expect(message.subject).toBe("Doctor.School — заявка получена");
    expect(message.text).toContain(
      "Ваша заявка «Ранняя реабилитация после артроскопии» (устный доклад) " +
        "получена и передана программному комитету Конгресс-2027. " +
        "Статус можно посмотреть в кабинете.",
    );
    expect(message.text.trimEnd().endsWith("Команда Doctor.School")).toBe(true);
  });

  it("EARS-14: the receipt carries no link, no button and no URL in either part, naming the congress site only as text", () => {
    const message = congressSubmissionReceiptMessage(RECEIPT);

    expectNoLinkOnlyTheDomainAsText(message);
    expect(message.text).not.toContain("Мои заявки на Конгресс:");
  });

  it("EARS-14: each kind is named in running text as the section names it", () => {
    for (const [kindLabel, inText] of [
      ["Постерный доклад", "(постерный доклад)"],
      ["Тезисы", "(тезисы)"],
    ] as const) {
      expect(
        congressSubmissionReceiptMessage({ ...RECEIPT, kindLabel }).text,
      ).toContain(inText);
    }
  });

  it("EARS-14: no internal term reaches the letter", () => {
    const message = congressSubmissionReceiptMessage(RECEIPT);
    for (const internal of ["витрина", "storefront", "draft", "submitted"]) {
      expect(message.text).not.toContain(internal);
      expect(message.html).not.toContain(internal);
    }
  });
});

describe("046 EARS-29, EARS-35: the committee decision and extension letters", () => {
  const SUBMISSION = {
    title: "Ранняя реабилитация после артроскопии",
    kindLabel: "Устный доклад",
  } as const;
  const CABINET_ENTRY =
    "Чтобы открыть заявку, зайдите на сайт Конгресса orthobio.ru. В разделе " +
    "«Участникам» найдите «Как подать материалы» и нажмите «Войти в кабинет». " +
    "Войти можно по коду из письма, пароль не нужен.";

  const LETTERS = [
    {
      content: { ...SUBMISSION, letter: "accepted" as const },
      subject: "Doctor.School — заявка принята",
      text:
        "Программный комитет принял вашу заявку «Ранняя реабилитация после " +
        "артроскопии» (устный доклад).",
    },
    {
      content: {
        ...SUBMISSION,
        letter: "rejected" as const,
        comment: "Тема вне программы конгресса",
      },
      subject: "Doctor.School — заявка отклонена",
      text:
        "Программный комитет отклонил заявку «Ранняя реабилитация после " +
        "артроскопии» (устный доклад). Комментарий комитета: Тема вне " +
        "программы конгресса",
    },
    {
      content: {
        ...SUBMISSION,
        letter: "needs_revision" as const,
        comment: "Сократите аннотацию",
        lastDay: "19.02.2027",
      },
      subject: "Doctor.School — заявку нужно доработать",
      text:
        "Программный комитет просит доработать заявку «Ранняя реабилитация " +
        "после артроскопии» (устный доклад): Сократите аннотацию. Исправить и " +
        "отправить заявку можно в кабинете до 19.02.2027, 23:59 МСК.",
    },
    {
      content: {
        ...SUBMISSION,
        letter: "revision_extended" as const,
        lastDay: "03.03.2027",
      },
      subject: "Doctor.School — срок доработки продлён",
      text:
        "Срок доработки заявки «Ранняя реабилитация после артроскопии» " +
        "(устный доклад) продлён. Исправить и отправить заявку можно в " +
        "кабинете до 03.03.2027, 23:59 МСК.",
    },
  ];

  for (const { content, subject, text } of LETTERS) {
    it(`046 EARS-29: the ${content.letter} letter carries the approved subject and text verbatim, ending with the cabinet-entry paragraph`, () => {
      const message = congressSubmissionDecisionMessage(content);
      expect(message.subject).toBe(subject);
      expect(message.text).toContain(text);
      expect(message.text).toContain(CABINET_ENTRY);
      expect(message.text.indexOf(CABINET_ENTRY)).toBeGreaterThan(
        message.text.indexOf(text),
      );
      expect(message.text.trimEnd().endsWith("Команда Doctor.School")).toBe(
        true,
      );
    });

    it(`046 EARS-29: the ${content.letter} letter carries no link, no button and no URL`, () => {
      expectNoLinkOnlyTheDomainAsText(
        congressSubmissionDecisionMessage(content),
      );
    });
  }

  it("046 EARS-29: the committee comment reaches the letter verbatim, never as markup", () => {
    const message = congressSubmissionDecisionMessage({
      ...SUBMISSION,
      letter: "rejected",
      comment: "<b>Нет</b> & нет",
    });
    expect(message.text).toContain("Комментарий комитета: <b>Нет</b> & нет");
    expect(message.html).not.toContain("<b>Нет</b>");
  });

  for (const comment of [
    "Добавьте иллюстрацию.",
    "Добавьте иллюстрацию!",
    "Добавьте иллюстрацию?",
    "Добавьте иллюстрацию…",
    "Добавьте иллюстрацию...",
    "Добавьте иллюстрацию. ",
  ]) {
    it(`046 EARS-29: the committee comment ${JSON.stringify(comment)} keeps its own terminal mark — no second full stop`, () => {
      const message = congressSubmissionDecisionMessage({
        ...SUBMISSION,
        letter: "needs_revision",
        comment,
        lastDay: "19.02.2027",
      });
      const joined = `${comment.trimEnd()} Исправить и отправить заявку`;
      expect(message.text).toContain(joined);
      expect(message.html).toContain(joined);
    });
  }

  it("046 EARS-29: a committee comment with no terminal mark gets one full stop before the deadline sentence", () => {
    const message = congressSubmissionDecisionMessage({
      ...SUBMISSION,
      letter: "needs_revision",
      comment: "Сократите аннотацию ",
      lastDay: "19.02.2027",
    });
    const joined = "Сократите аннотацию. Исправить и отправить заявку";
    expect(message.text).toContain(joined);
    expect(message.html).toContain(joined);
  });

  it("046 EARS-29: endSentence closes a sentence once — a terminal mark kept, a full stop added otherwise", () => {
    expect(endSentence("Готово.")).toBe("Готово.");
    expect(endSentence("Готово!")).toBe("Готово!");
    expect(endSentence("Готово?")).toBe("Готово?");
    expect(endSentence("Готово…")).toBe("Готово…");
    expect(endSentence("Готово...")).toBe("Готово...");
    expect(endSentence("Готово.  ")).toBe("Готово.");
    expect(endSentence("Готово")).toBe("Готово.");
  });

  it("046 EARS-29, EARS-35: «{дата}» is the last day — the day before the stored instant — in Moscow", () => {
    // Stored 2027-03-04T00:00+03:00 → last day 03.03.2027 (V-12).
    expect(formatRevisionLastDay(new Date("2027-03-03T21:00:00.000Z"))).toBe(
      "03.03.2027",
    );
    // Stored 2027-02-20T00:00+03:00 → last day 19.02.2027 (V-12).
    expect(formatRevisionLastDay(new Date("2027-02-19T21:00:00.000Z"))).toBe(
      "19.02.2027",
    );
  });
});
