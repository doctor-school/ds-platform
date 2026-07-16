import { describe, expect, it } from "vitest";
import {
  CODE_EMAIL_SUBJECT_TAILS,
  passwordResetCodeEmail,
  verificationCodeEmail,
} from "./code-emails.js";

// 003 EARS-29 (#910, design §13.3/§13.4): the verify/reset one-time-code emails
// are BFF-composed specified artifacts — branded, Russian, CODE-ONLY, fully
// link-free (the owner-picked Notion/Slack style). These pins are the SSOT-side
// half of the contract the live Mailpit e2e re-proves on the rendered mail.

const CODE = "GX5AVU";

describe("003 EARS-29 code-only email artifacts (§13.3/§13.4)", () => {
  const artifacts = [
    {
      name: "verification (§13.3)",
      msg: verificationCodeEmail(CODE),
      tail: CODE_EMAIL_SUBJECT_TAILS.verifyEmail,
      ignoreLine: "Если вы не регистрировались на Doctor.School",
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
