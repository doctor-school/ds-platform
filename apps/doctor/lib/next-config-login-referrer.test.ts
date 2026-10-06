import { describe, expect, it } from "vitest";

import config from "../next.config";

/**
 * 003 EARS-44 leak control — `/login` can carry a live Congress hand-off
 * reference in its query until the door strips it, so its responses send
 * `Referrer-Policy: no-referrer`: no request leaving the page (an asset, a
 * captcha, a link) ever carries the reference in a Referer header.
 */
describe("003 EARS-44: /login is served with Referrer-Policy: no-referrer", () => {
  it("003 EARS-44: the /login response carries Referrer-Policy: no-referrer", async () => {
    expect(typeof config.headers).toBe("function");
    const rules = await config.headers!();
    const login = rules.find((rule) => rule.source === "/login");
    expect(login?.headers).toContainEqual({
      key: "Referrer-Policy",
      value: "no-referrer",
    });
  });
});
