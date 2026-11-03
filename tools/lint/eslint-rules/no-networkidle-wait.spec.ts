import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";

import rule from "./no-networkidle-wait.mjs";

/**
 * Unit proof for the `no-networkidle-wait` gate (#3465).
 *
 * A shared e2e step that waits for `networkidle` hangs on any page carrying the
 * real Yandex SmartCaptcha widget: the widget iframe's Metrika beacon never
 * settles, so the wait sits until the test timeout. The "invalid" cases are every
 * Playwright entry point that takes the `networkidle` state; the "valid" cases
 * prove the rule does not over-fire on the states that do settle.
 */
const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaVersion: "latest", sourceType: "module" },
  },
});

describe("no-networkidle-wait", () => {
  it("flags the networkidle state on every Playwright wait entry point; allows load / domcontentloaded", () => {
    ruleTester.run("no-networkidle-wait", rule, {
      valid: [
        { code: `await page.waitForLoadState("load");` },
        { code: `await page.waitForLoadState();` },
        { code: `await page.goto(url, { waitUntil: "load" });` },
        { code: `await page.goto(url, { waitUntil: "domcontentloaded" });` },
        { code: `await page.waitForURL(/x/, { waitUntil: "commit" });` },
        // The word in prose or an unrelated call is not a wait.
        { code: `const note = "networkidle never settles";` },
        { code: `log({ waitUntil: "networkidle" });` },
        {
          code: `let state = "networkidle"; state = "load"; await page.waitForLoadState(state);`,
        },
      ],
      invalid: [
        {
          code: `await page.waitForLoadState("networkidle");`,
          errors: [{ messageId: "networkidle" }],
        },
        {
          code: "await visitor.page.waitForLoadState(`networkidle`);",
          errors: [{ messageId: "networkidle" }],
        },
        {
          code: `await page.goto(url, { waitUntil: "networkidle" });`,
          errors: [{ messageId: "networkidle" }],
        },
        {
          code: `await page.waitForURL(/x/, { timeout: 5, waitUntil: "networkidle" });`,
          errors: [{ messageId: "networkidle" }],
        },
        {
          code: `await page.waitForNavigation({ waitUntil: "networkidle" });`,
          errors: [{ messageId: "networkidle" }],
        },
        {
          code: `await page.reload({ waitUntil: "networkidle" });`,
          errors: [{ messageId: "networkidle" }],
        },
        {
          code: `await page.goBack({ waitUntil: "networkidle" });`,
          errors: [{ messageId: "networkidle" }],
        },
        {
          code: `await page.setContent(html, { waitUntil: "networkidle" });`,
          errors: [{ messageId: "networkidle" }],
        },
        {
          code: `await page.waitForLoadState("networkidle" as const);`,
          errors: [{ messageId: "networkidle" }],
        },
        {
          code: `const IDLE = "networkidle" as const; await page.goto(url, { waitUntil: IDLE });`,
          errors: [{ messageId: "networkidle" }],
        },
        {
          code: `const state = "networkidle"; await page.waitForLoadState(state);`,
          errors: [{ messageId: "networkidle" }],
        },
      ],
    });
  });
});
