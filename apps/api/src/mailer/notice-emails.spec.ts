import { describe, expect, it } from "vitest";
import {
  congressConfirmationMessage,
  formatCongressEventDate,
} from "./notice-emails.js";

/**
 * 044 EARS-13 — the confirmation-email COPY, pinned string by string.
 *
 * The owner approved this wording verbatim (#2287 issuecomment-5756369423) and
 * the spec quotes it verbatim
 * (`apps/docs/content/specs/features/044-congress-signup/044-requirements-en.md`).
 * A paraphrase is therefore a defect and not a style choice, which is why these
 * assertions compare whole sentences rather than «contains the word аккаунт».
 *
 * Both variants are asserted in full, and each also asserts the ABSENCE of the
 * other's sentence: the only difference between them is one paragraph, and a
 * regression that renders both (or the wrong one) is exactly the failure a
 * «contains» assertion would sail past.
 */

const BASE = {
  portalBaseUrl: "https://academy.example.test",
  eventTitle: "Конгресс-2027",
  eventDate: "12 марта 2027 г. в 10:00",
  eventVenue: "Москва, Крокус Экспо",
} as const;

const NEW_ACCOUNT_PARAGRAPH =
  "Для вас создан аккаунт Doctor.School на этот адрес электронной почты. " +
  "Пароль не нужен: чтобы войти, укажите этот адрес и введите код из письма.";
const EXISTING_ACCOUNT_PARAGRAPH =
  "Регистрация добавлена в ваш аккаунт Doctor.School. Создавать новый не нужно.";

describe("044 EARS-13: the congress confirmation email", () => {
  it("044 EARS-13.1: the new-account variant shall carry the approved subject, first line and account paragraph", () => {
    const message = congressConfirmationMessage({
      ...BASE,
      accountIsNew: true,
    });

    expect(message.subject).toBe(
      "Doctor.School — вы зарегистрированы на Конгресс-2027",
    );
    expect(message.text).toContain(
      "Вы зарегистрированы на Конгресс-2027: 12 марта 2027 г. в 10:00, " +
        "Москва, Крокус Экспо.",
    );
    expect(message.text).toContain(NEW_ACCOUNT_PARAGRAPH);
    expect(message.text).not.toContain(EXISTING_ACCOUNT_PARAGRAPH);
    expect(message.text).toContain(
      "Войти: https://academy.example.test/login",
    );
    expect(message.text).toContain(
      "Если это были не вы, просто проигнорируйте это письмо.",
    );
    expect(message.text).toContain("Команда Doctor.School");
  });

  it("044 EARS-13.2: the existing-account variant shall differ only in the account paragraph", () => {
    const newAccount = congressConfirmationMessage({
      ...BASE,
      accountIsNew: true,
    });
    const existing = congressConfirmationMessage({
      ...BASE,
      accountIsNew: false,
    });

    expect(existing.subject).toBe(newAccount.subject);
    expect(existing.text).toContain(
      "Вы зарегистрированы на Конгресс-2027: 12 марта 2027 г. в 10:00, " +
        "Москва, Крокус Экспо.",
    );
    expect(existing.text).toContain(EXISTING_ACCOUNT_PARAGRAPH);
    expect(existing.text).not.toContain(NEW_ACCOUNT_PARAGRAPH);
    // The ONE difference: swapping that paragraph back makes the two identical,
    // which is the structural statement «the copy branches exactly once».
    expect(
      existing.text.replace(
        EXISTING_ACCOUNT_PARAGRAPH,
        NEW_ACCOUNT_PARAGRAPH,
      ),
    ).toBe(newAccount.text);
  });

  it("044 EARS-13.3: the configured portal destination shall be escaped as one HTML attribute", () => {
    const message = congressConfirmationMessage({
      ...BASE,
      portalBaseUrl: 'https://academy.example.test/a&b"<test>',
      accountIsNew: true,
    });

    expect(message.html).toContain(
      'href="https://academy.example.test/a&amp;b&quot;&lt;test&gt;/login"',
    );
    expect(message.html).not.toContain("<test>");
  });

  it("044 EARS-13.4: the event instant shall render as Moscow wall-clock regardless of the server zone", () => {
    // 2027-03-12T07:00Z is 10:00 in Moscow (UTC+3, no DST since 2014).
    expect(
      formatCongressEventDate(new Date("2027-03-12T07:00:00.000Z")),
    ).toBe("12 марта 2027 г. в 10:00");
  });
});
