import { describe, expect, it } from "vitest";
import {
  congressConfirmationMessage,
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

const CONTENT = {
  eventTitle: "Конгресс-2027",
  eventDate: "12 марта 2027 г. в 10:00",
  eventVenue: "Москва, Крокус Экспо",
} as const;

const REMOVED = ["аккаунт", "Пароль не нужен", "Войти", "/login"] as const;

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
});
