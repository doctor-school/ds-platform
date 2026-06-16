import { describe, expect, it } from "vitest";

import { extractPhone, extractText } from "./server.mjs";

// Real captured Zitadel v4.15 SMS webhook payload (live dev-stand). The webhook
// is NESTED: the recipient is under `contextInfo.recipientPhoneNumber` and the
// rendered text under `templateData.text` — NOT the top-level flat fields the
// adapter originally read (#225).
const CAPTURED = {
  contextInfo: {
    eventType: "session.otp.sms.challenged",
    provider: { id: "376748582390204677", description: "dev-stand sms-sink" },
    recipientPhoneNumber: "+79255131223",
  },
  templateData: {
    title: "VerifySMSOTP.Title",
    text: "64883313 — это ваш OTP для truenas.local. Используйте его в течение следующих 5m0s.\n@truenas.local #64883313",
    subject: "VerifySMSOTP.Subject",
  },
  args: {
    verifiedPhone: "+79255131223",
    lastPhone: "+79255131223",
    oTP: "64883313",
    loginName: "a@preencipium.com",
  },
};

describe("extractPhone", () => {
  it("reads the nested contextInfo.recipientPhoneNumber from the real v4.15 payload", () => {
    expect(extractPhone(CAPTURED)).toBe("+79255131223");
  });

  it("falls back to args.verifiedPhone when contextInfo + flat aliases are absent", () => {
    const msg = {
      args: { verifiedPhone: "+70000000001", lastPhone: "+70000000002" },
    };
    expect(extractPhone(msg)).toBe("+70000000001");
  });

  it("falls back to args.lastPhone after verifiedPhone is absent", () => {
    const msg = { args: { lastPhone: "+70000000002" } };
    expect(extractPhone(msg)).toBe("+70000000002");
  });

  it("still honors the legacy flat recipientPhoneNumber (back-compat)", () => {
    expect(extractPhone({ recipientPhoneNumber: "+71112223344" })).toBe(
      "+71112223344",
    );
  });

  it("prefers contextInfo over flat aliases and args", () => {
    const msg = {
      contextInfo: { recipientPhoneNumber: "+79255131223" },
      recipientPhoneNumber: "+70000000000",
      args: { verifiedPhone: "+70000000001" },
    };
    expect(extractPhone(msg)).toBe("+79255131223");
  });

  it("trims whitespace and skips empty candidates", () => {
    expect(
      extractPhone({
        contextInfo: { recipientPhoneNumber: "  " },
        recipient: "  +79255131223 ",
      }),
    ).toBe("+79255131223");
  });

  it("returns null for a payload with no recognizable phone field (fail-closed)", () => {
    expect(
      extractPhone({
        contextInfo: { eventType: "x" },
        templateData: { text: "hi" },
      }),
    ).toBeNull();
  });

  it("returns null for null / non-object input", () => {
    expect(extractPhone(null)).toBeNull();
    expect(extractPhone(undefined)).toBeNull();
    expect(extractPhone("string")).toBeNull();
    expect(extractPhone(42)).toBeNull();
  });
});

describe("extractText", () => {
  it("reads templateData.text from the real v4.15 payload", () => {
    expect(extractText(CAPTURED)).toBe(CAPTURED.templateData.text);
  });

  it("prefers templateData.text over a flat text when both present", () => {
    const msg = { templateData: { text: "nested" }, text: "flat" };
    expect(extractText(msg)).toBe("nested");
  });

  it("falls back to the flat text alias", () => {
    expect(extractText({ text: "flat body" })).toBe("flat body");
  });

  it("returns empty string when no text field is present", () => {
    expect(extractText({ contextInfo: {} })).toBe("");
    expect(extractText(null)).toBe("");
  });
});
