import { describe, expect, it } from "vitest";

import { contentSecurityPolicy } from "./host-headers";

function directive(policy: string, name: string): string[] {
  const found = policy
    .split(";")
    .map((part) => part.trim().split(/\s+/))
    .find(([head]) => head === name);
  return found ? found.slice(1) : [];
}

describe("the sign-in host CSP admits the SmartCaptcha widget", () => {
  // `@yandex/smart-captcha` loads `captcha.js` from smartcaptcha.cloud.yandex.ru
  // and the loader frames and calls its own origin; a policy naming only the
  // yandexcloud.net alias blocks the widget, so the gated form never gets a
  // token (observed on slot pr-3265: "Framing 'https://smartcaptcha.cloud.
  // yandex.ru/' violates … frame-src https://smartcaptcha.yandexcloud.net").
  const ORIGINS = [
    "https://smartcaptcha.cloud.yandex.ru",
    "https://smartcaptcha.yandexcloud.net",
  ];

  it("003 EARS-17: frame-src and connect-src carry every SmartCaptcha origin", () => {
    const policy = contentSecurityPolicy("bm9uY2U=", false);
    for (const name of ["frame-src", "connect-src"]) {
      expect(directive(policy, name)).toEqual(expect.arrayContaining(ORIGINS));
    }
  });
});
