import { describe, expect, it } from "vitest";
import {
  CODE_EMAIL_SUBJECT_TAILS,
  codeLifetimeLine,
  LOGIN_EMAIL_CODE_LIFETIME_SECONDS,
  loginCodeEmail,
  PASSWORD_RESET_CODE_LIFETIME_SECONDS,
  VERIFY_EMAIL_CODE_LIFETIME_SECONDS,
  passwordResetCodeEmail,
  verificationCodeEmail,
} from "./code-emails.js";

// 003 EARS-29 (#910, design §13.3/§13.4): the verify/reset one-time-code emails
// are BFF-composed specified artifacts — branded, Russian, CODE-ONLY, fully
// link-free (the owner-picked Notion/Slack style). These pins are the SSOT-side
// half of the contract the live Mailpit e2e re-proves on the rendered mail.

const CODE = "482916";

describe("003 EARS-29 code-only email artifacts (§13.3/§13.4)", () => {
  const artifacts = [
    {
      name: "verification (§13.3)",
      msg: verificationCodeEmail(CODE),
      tail: CODE_EMAIL_SUBJECT_TAILS.verifyEmail,
      ignoreLine: "Если вы не запрашивали код — проигнорируйте это письмо",
    },
    {
      name: "password reset (§13.4)",
      msg: passwordResetCodeEmail(CODE),
      tail: CODE_EMAIL_SUBJECT_TAILS.passwordReset,
      ignoreLine: "Если вы не запрашивали сброс пароля",
    },
  ];

  for (const { name, msg, tail, ignoreLine } of artifacts) {
    it(`EARS-29: ${name} — the code LEADS the subject, stable branded tail, < 50 chars`, () => {
      expect(msg.subject).toBe(`${CODE} — ${tail}`);
      expect(msg.subject.startsWith(CODE)).toBe(true);
      expect(msg.subject.length).toBeLessThan(50);
    });

    it(`EARS-29: ${name} — the body carries the code as ONE unbroken enlarged token`, () => {
      // The live e2e pins `<strong>${code}</strong>` — the token is unbroken
      // (no spacing/triads inside the tag) and enlarged via inline CSS.
      expect(msg.html).toContain(`<strong>${CODE}</strong>`);
      expect(msg.text).toContain(CODE);
    });

    it(`EARS-29: ${name} — zero links: no <a> element and no URL anywhere (html + text)`, () => {
      expect(msg.html.toLowerCase()).not.toMatch(/<a[\s>]/);
      expect(msg.html).not.toMatch(/https?:\/\//);
      expect(msg.text).not.toMatch(/https?:\/\//);
    });

    it(`EARS-29: ${name} — explicit RU expiry line («Код действует 1 час», the 3600 s generator lifetime)`, () => {
      expect(msg.html).toContain("Код действует 1 час");
      expect(msg.text).toContain("Код действует 1 час");
    });

    it(`EARS-29: ${name} — RU greeting + not-you ignore line`, () => {
      expect(msg.html).toContain("Здравствуйте!");
      expect(msg.text).toContain("Здравствуйте!");
      expect(msg.html).toContain(ignoreLine);
      expect(msg.text).toContain(ignoreLine);
    });
  }

  it("EARS-29: the two artifacts are never confusable — distinct subjects and instructions", () => {
    const verify = verificationCodeEmail(CODE);
    const reset = passwordResetCodeEmail(CODE);
    expect(verify.subject).not.toBe(reset.subject);
    expect(CODE_EMAIL_SUBJECT_TAILS.verifyEmail).not.toBe(
      CODE_EMAIL_SUBJECT_TAILS.passwordReset,
    );
  });
});

for (const render of [verificationCodeEmail, passwordResetCodeEmail]) {
  it("EARS-29: directs code entry to the already-open requesting tab in both parts", () => {
    const message = render(CODE);
    for (const body of [message.html, message.text]) {
      expect(body).toContain("уже открытой вкладке");
      expect(body).toContain("Введите код в уже открытой вкладке");
    }
  });
  it("EARS-29: interpolated tokens cannot inject HTML", () => {
    const message = render('<>&"');
    expect(message.html).toContain("<strong>&lt;&gt;&amp;&quot;</strong>");
    expect(message.text).toContain('<>&"');
  });
}

// #2814: the lifetime the email states is rendered from the exported constants
// the deploy's IdP read-back pins the generators to (tools/deploy/idp-policy.mjs)
// — one source for the copy and the check.
describe("#2814 code lifetime — one source for the copy and the deploy check", () => {
  it("states each lifetime constant in Russian with the right plural", () => {
    expect(codeLifetimeLine(VERIFY_EMAIL_CODE_LIFETIME_SECONDS)).toBe(
      "Код действует 1 час.",
    );
    expect(codeLifetimeLine(PASSWORD_RESET_CODE_LIFETIME_SECONDS)).toBe(
      "Код действует 1 час.",
    );
    expect(codeLifetimeLine(LOGIN_EMAIL_CODE_LIFETIME_SECONDS)).toBe(
      "Код действует 5 минут.",
    );
    expect(codeLifetimeLine(7200)).toBe("Код действует 2 часа.");
    expect(codeLifetimeLine(60)).toBe("Код действует 1 минуту.");
  });

  it("refuses a lifetime the copy cannot state in whole minutes", () => {
    expect(() => codeLifetimeLine(90)).toThrow();
    expect(() => codeLifetimeLine(0)).toThrow();
  });

  it("the verification, reset and login mails carry their own constant's line", () => {
    expect(verificationCodeEmail(CODE).text).toContain(
      codeLifetimeLine(VERIFY_EMAIL_CODE_LIFETIME_SECONDS),
    );
    expect(passwordResetCodeEmail(CODE).text).toContain(
      codeLifetimeLine(PASSWORD_RESET_CODE_LIFETIME_SECONDS),
    );
    expect(loginCodeEmail(CODE, "5m").text).toContain(
      codeLifetimeLine(LOGIN_EMAIL_CODE_LIFETIME_SECONDS),
    );
    expect(loginCodeEmail(CODE, "1h").text).toContain(
      codeLifetimeLine(VERIFY_EMAIL_CODE_LIFETIME_SECONDS),
    );
  });
});
