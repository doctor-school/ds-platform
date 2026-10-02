import { describe, expect, it } from "vitest";
import {
  congressCabinetUrl,
  congressConfirmationMessage,
  congressSubmissionReceiptMessage,
  formatCongressEventDate,
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

const CABINET_URL = "https://new.doctor.school/account/congress";

const CONTENT = {
  eventTitle: "Конгресс-2027",
  eventDate: "12 марта 2027 г. в 10:00",
  eventVenue: "Москва, Крокус Экспо",
} as const;

const REMOVED = ["аккаунт", "Пароль не нужен", "Войти", "/login"] as const;

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
    expect(
      formatCongressEventDate(new Date("2027-03-12T07:00:00.000Z")),
    ).toBe("12 марта 2027 г. в 10:00");
  });

  it("046 EARS-15: the confirmation shall carry no link, no button and no URL in either part", () => {
    const message = congressConfirmationMessage(CONTENT);

    expect(htmlLinks(message.html)).toEqual([]);
    expect(message.html).not.toMatch(/href=/);
    for (const part of [message.text, message.html]) {
      expect(part).not.toMatch(/https?:\/\//);
      expect(part).not.toContain("/account/congress");
      expect(part).not.toContain("Подать материалы в кабинете");
    }
  });
});

describe("046 «Letters»: the cabinet link", () => {
  it("EARS-14: the cabinet URL is /account/congress on the doctor storefront origin, trailing slashes dropped", () => {
    expect(congressCabinetUrl("https://new.doctor.school")).toBe(CABINET_URL);
    expect(congressCabinetUrl("https://new.doctor.school/")).toBe(CABINET_URL);
  });
});

describe("046 EARS-14: the submission receipt", () => {
  const RECEIPT = {
    title: "Ранняя реабилитация после артроскопии",
    kindLabel: "Устный доклад",
    eventTitle: "Конгресс-2027",
    cabinetUrl: CABINET_URL,
  } as const;

  it("EARS-14: the receipt carries the approved subject, text, action and footer verbatim", () => {
    const message = congressSubmissionReceiptMessage(RECEIPT);

    expect(message.subject).toBe("Doctor.School — заявка получена");
    expect(message.text).toContain(
      "Ваша заявка «Ранняя реабилитация после артроскопии» (устный доклад) " +
        "получена и передана программному комитету Конгресс-2027. " +
        "Статус можно посмотреть в кабинете.",
    );
    expect(message.text).toContain(`Мои заявки на Конгресс: ${CABINET_URL}`);
    expect(message.text.trimEnd().endsWith("Команда Doctor.School")).toBe(
      true,
    );
    expect(htmlLinks(message.html)).toEqual([
      { url: CABINET_URL, label: "Мои заявки на Конгресс" },
    ]);
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
