import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { bootstrapAdminSession } from "../support/admin-session";
import { totpCode } from "../support/totp";

/**
 * 011 EARS-12 — the enrollment and challenge screens are **localized and
 * accessible**, proven end to end in one place.
 *
 * EARS-12 is a single clause with two halves that fail together in practice: a
 * string that never reached the catalog is also a string a screen reader reads
 * in the wrong language, and a code field with no accessible name is a daily
 * lockout for the operator who depends on one. So this suite asserts both halves
 * of the clause against the same rendered screens — every visible string equals
 * its RU catalog value and no raw key or unsubstituted placeholder leaks; the
 * QR carries a text alternative and the secret is selectable TEXT rather than
 * pixels; the code field is reachable and fillable by keyboard alone and carries
 * the catalog's label as its accessible name; and axe reports no WCAG 2 A/AA
 * violation on either screen, including the screen carrying its failure Alert.
 *
 * These screens are **not skippable**: an admin who cannot operate them cannot
 * get in at all, and the challenge is walked on EVERY login after the first. Its
 * accessibility is the kind that compounds.
 *
 * Why here rather than in the flow tier: this is the a11y gate — `pnpm
 * --filter @ds/admin test:axe` green must mean "the admin surface, 011 screens
 * included, is WCAG clean". The 007 scan (`a11y-axe.e2e.spec.ts`) keeps the
 * event surface; the 011 screens moved here, where the i18n half of the clause
 * lives with them instead of being split across two files.
 *
 * Dev-stand-gated and MANUAL like its siblings — `bootstrapAdminSession`
 * provisions a real `platform_admin` against the stand's Zitadel and throws when
 * the `IDP_*` env is absent, so a stray invocation fails fast rather than
 * pretending to pass:
 *
 *   E2E_ADMIN_URL=http://localhost:3200 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin test:axe
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const ORIGIN = process.env.E2E_ADMIN_URL ?? "http://localhost:3200";

/**
 * The shipped RU catalog, read from the SAME file the app renders from. The
 * point of EARS-12's "resolves from the typed Russian message catalog" is that
 * the screen holds no copy of its own — so the assertion has to compare against
 * the catalog itself, not against strings re-typed into a test (which would pass
 * happily while the screen hardcoded every one of them).
 */
const ru = JSON.parse(
  readFileSync(new URL("../../messages/ru.json", import.meta.url), "utf8"),
) as {
  mfaEnroll: Record<string, string>;
  mfaChallenge: Record<string, string>;
};

/**
 * A catalog key that reached the DOM unresolved, or an ICU placeholder that was
 * never substituted — both render as visible gibberish to an operator, and both
 * are invisible to a test that only checks that the expected strings are
 * present.
 */
const UNRESOLVED = /mfaEnroll\.|mfaChallenge\.|\{issuer\}|\{[a-zA-Z]+\}/;

async function scan(page: Page, label: string) {
  await page.locator("main, form, body").first().waitFor({ state: "visible" });
  // The wave-1 admin is light-only (no theme toggle) — ensure no stray `.dark`.
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target).flat(),
  }));
  expect(summary, `axe violations on ${label} (${page.url()})`).toEqual([]);
}

/**
 * Is `target` reachable by the Tab key alone? A field an operator can only reach
 * with a pointer is not "operable by keyboard" however well it is labelled —
 * and a control lifted out of the tab order is the classic way an OTP widget
 * breaks for keyboard and screen-reader users.
 */
async function reachableByTab(page: Page, target: Locator): Promise<boolean> {
  for (let step = 0; step < 20; step++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement))
      return true;
  }
  return false;
}

/** Complete primary auth in the page context, so the pending reference is set. */
async function primaryAuth(
  page: Page,
  credentials: { email: string; password: string },
): Promise<void> {
  await page.goto("/login");
  await page.evaluate(async (creds) => {
    const res = await fetch("/v1/admin/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identifier: creds.email,
        password: creds.password,
      }),
    });
    if (!res.ok) throw new Error(`admin primary auth failed: ${res.status}`);
  }, credentials);
}

/** Sign in through the real login FORM (a browser navigation sets the cookies). */
async function signIn(
  page: Page,
  credentials: { email: string; password: string },
): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(credentials.email);
  await page.locator("#password").fill(credentials.password);
  await page.getByTestId("login-submit").click();
}

test.describe.configure({ mode: "serial" });

test.describe("011 EARS-12 — the MFA screens are localized and accessible", () => {
  test("the enrollment screen renders only catalog copy, is keyboard-operable, and passes WCAG 2 A/AA", async ({
    page,
  }) => {
    const credentials = await bootstrapAdminSession(ORIGIN);
    await primaryAuth(page, credentials);
    await page.goto("/mfa/enroll");
    await page.getByTestId("mfa-qr").waitFor({ state: "visible" });

    // Every visible string is the catalog's, and nothing unresolved leaked.
    for (const key of [
      "title",
      "description",
      "scanTitle",
      "secretTitle",
      "secretHint",
      "submit",
      "lostFactor",
    ] as const) {
      await expect(
        page.getByText(ru.mfaEnroll[key]!, { exact: false }).first(),
        `mfaEnroll.${key} must render from the catalog`,
      ).toBeVisible();
    }
    expect(await page.locator("body").innerText()).not.toMatch(UNRESOLVED);

    // The QR carries a text alternative — an operator using a screen reader
    // cannot scan an image, and this screen cannot be skipped.
    const qr = page.getByTestId("mfa-qr");
    await expect(qr).toHaveAttribute("role", "img");
    const qrAlt = await qr.getAttribute("aria-label");
    // Compared against the CATALOG, not a literal re-typed here — the same
    // discipline the rest of this suite applies, and `qrAlt` is the one string on
    // either screen carrying an ICU placeholder, so it is also the one where a
    // hand-written expectation would hide the interesting failure.
    expect(qrAlt).toContain(ru.mfaEnroll.qrAlt!.split("{issuer}")[0]!.trim());
    // …and the placeholder is SUBSTITUTED. This lives in an attribute, which
    // `innerText` does not include — so the body-level `UNRESOLVED` sweep below
    // cannot see it, and a never-substituted `{issuer}` would sail through the
    // suite that advertises "no unsubstituted placeholder in the DOM".
    expect(qrAlt).not.toMatch(UNRESOLVED);

    // The secret is selectable TEXT, not pixels: the operator whose app cannot
    // scan types it, and a screen reader reads it out.
    const secret = page.getByTestId("mfa-secret");
    await expect(secret).toHaveJSProperty("tagName", "CODE");
    expect((await secret.innerText()).trim()).toMatch(/^[A-Z2-7]{16,}$/);

    // The code field is labelled and reachable by the keyboard alone.
    const field = page.getByTestId("mfa-enroll-form").getByRole("textbox");
    await expect(field).toHaveAccessibleName(ru.mfaEnroll.codeLabel!);
    expect(
      await reachableByTab(page, field),
      "the code field must be reachable by Tab alone",
    ).toBe(true);

    await scan(page, "enrollment screen");

    // …and the same screen carrying its refusal, because an error an operator
    // cannot perceive is the same as no error at all. Typed on the KEYBOARD, so
    // the field is proven fillable and not merely focusable.
    await field.focus();
    await page.keyboard.type("000000");
    await expect(field).toHaveValue("000000");
    const error = page.getByTestId("mfa-error");
    await error.waitFor({ state: "visible" });
    // `toContainText`, not `toHaveText`: the DS `Alert` renders a decorative ✕
    // glyph beside the message, so the assertion is that the CATALOG string is
    // what an operator reads — not that the Alert has no chrome of its own.
    await expect(error).toContainText(ru.mfaEnroll.errorGeneric!);
    await scan(page, "enrollment screen with its refusal");
  });

  test("the challenge screen renders only catalog copy, is keyboard-operable, and passes WCAG 2 A/AA", async ({
    page,
  }) => {
    const credentials = await bootstrapAdminSession(ORIGIN);

    // Reached the real way — enrol first, then log back in. A seeded factor
    // would let a broken gate pass this scan unnoticed.
    await signIn(page, credentials);
    await page.waitForURL(/\/mfa\/enroll/, { timeout: 20_000 });
    const secret = (await page.getByTestId("mfa-secret").innerText()).trim();
    await page
      .getByTestId("mfa-enroll-form")
      .getByRole("textbox")
      .fill(totpCode(secret));
    await page.waitForURL(/\/events/, { timeout: 20_000 });
    await page.getByTestId("sign-out").click();
    await page.waitForURL(/\/login/, { timeout: 20_000 });
    await signIn(page, credentials);
    await page.waitForURL(/\/mfa\/challenge/, { timeout: 20_000 });
    await page.getByTestId("mfa-challenge-form").waitFor({ state: "visible" });

    for (const key of [
      "title",
      "description",
      "submit",
      "lostFactor",
    ] as const) {
      await expect(
        page.getByText(ru.mfaChallenge[key]!, { exact: false }).first(),
        `mfaChallenge.${key} must render from the catalog`,
      ).toBeVisible();
    }
    expect(await page.locator("body").innerText()).not.toMatch(UNRESOLVED);

    // No enrollment material on this screen: re-offering it to an operator who
    // already holds a factor would silently replace a live second factor.
    await expect(page.getByTestId("mfa-qr")).toHaveCount(0);

    const field = page.getByTestId("mfa-challenge-form").getByRole("textbox");
    await expect(field).toHaveAccessibleName(ru.mfaChallenge.codeLabel!);
    expect(
      await reachableByTab(page, field),
      "the code field must be reachable by Tab alone",
    ).toBe(true);

    await scan(page, "challenge screen");

    // The recovery guidance is on the screen BEFORE any failure — an operator
    // whose phone is lost needs it before they have burned ten attempts finding
    // out (LD-2).
    await expect(
      page.getByText(ru.mfaChallenge.lostFactor!).first(),
    ).toBeVisible();

    await field.focus();
    await page.keyboard.type("000000");
    await expect(field).toHaveValue("000000");
    const error = page.getByTestId("mfa-error");
    await error.waitFor({ state: "visible" });
    await expect(error).toContainText(ru.mfaChallenge.errorGeneric!);
    await scan(page, "challenge screen with its refusal");
  });
});
