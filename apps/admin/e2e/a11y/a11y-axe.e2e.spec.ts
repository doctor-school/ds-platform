import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { bootstrapAdminSession } from "../support/admin-session";
import { totpCode } from "../support/totp";

/**
 * 007 EARS-11 — axe-core WCAG 2 A/AA scan of the admin event surface (the runtime
 * twin of the CI `playwright-axe` BLOCK gate, which scans the DS primitives via
 * the showcase; this retargets it onto the admin composition). Scanned in the
 * light theme — the only theme the wave-1 admin renders (no toggle, see THEMES).
 * Dev-stand-gated like the BDD suite — it provisions a real platform_admin
 * session. The settled token fact it guards: text on `bg-card` uses card-safe AA
 * tokens (`text-primary-action`), never `text-primary`.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
// The wave-1 admin app is LIGHT-ONLY: it wires no theme toggle, so `<html>` never
// gets `.dark` and the operator only ever sees the light theme — the only
// reachable state to scan here. The DS dark-theme tokens are already covered by
// the showcase `playwright-axe` BLOCK gate (both themes). A dark admin theme is a
// wave-2 affordance (add the toggle → re-enable `"dark"` here).
const THEMES = ["light"] as const;
const ORIGIN = process.env.E2E_ADMIN_URL ?? "http://localhost:3200";

/**
 * Sign a freshly provisioned `platform_admin` all the way INTO admin.
 *
 * Since 011 that is two steps, not one: primary auth issues no session, and the
 * forced TOTP enrollment (EARS-4) is the only door onward. The helper therefore
 * walks the real gate — password, then the first code derived from the secret the
 * enrollment screen rendered — so the scanned event surfaces are reached the way
 * an operator reaches them, not through a back door that would let a broken gate
 * pass unnoticed.
 */
async function loginAsAdmin(page: Page): Promise<string> {
  const { email, password } = await bootstrapAdminSession(ORIGIN);
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await page.waitForTimeout(2500);
    await page.goto("/login");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.getByTestId("login-submit").click();
    try {
      await page.waitForURL(/\/mfa\/enroll/, { timeout: 8000 });
    } catch {
      /* role not yet projected — retry */
      continue;
    }
    const secret = (await page.getByTestId("mfa-secret").innerText()).trim();
    await page
      .getByTestId("mfa-enroll-form")
      .getByRole("textbox")
      .fill(totpCode(secret));
    await page.waitForURL(/\/events/, { timeout: 20_000 });
    return password;
  }
  throw new Error("admin login did not reach /events for the axe scan");
}

async function createEventForScan(page: Page): Promise<string> {
  await page.goto("/events/create");
  await page.locator("#title").fill("Axe-скан мероприятие");
  await page.locator("#school").fill("Кардиология");
  await page.locator("#startsAtMsk").fill("2026-07-17T19:00");
  await page.locator("#durationMin").fill("90");
  await page.getByTestId("program-pdf").setInputFiles({
    name: "program.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF"),
  });
  await page.getByTestId("submit-event").click();
  await page.waitForURL(/\/events\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
}

async function scan(page: Page, theme: (typeof THEMES)[number]) {
  await page.locator("main, form, body").first().waitFor({ state: "visible" });
  // Light is the only reachable admin theme (see THEMES) — ensure no stray `.dark`.
  void theme;
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target).flat(),
  }));
  expect(summary, `axe violations on ${page.url()} (${theme})`).toEqual([]);
}

test.describe.configure({ mode: "serial" });

test.describe("007 EARS-11 axe-core a11y scan of the admin event surface", () => {
  test("the login screen passes WCAG 2 A/AA (light)", async ({ page }) => {
    await page.goto("/login");
    for (const theme of THEMES) await scan(page, theme);
  });

  test("011 EARS-12: the TOTP enrollment screen passes WCAG 2 A/AA (light)", async ({
    page,
  }) => {
    // The 011 forced-enrollment screen is reachable only for a principal holding
    // a live pending-auth reference (EARS-4), so the scan drives the real admin
    // primary auth first rather than scanning an empty shell. The screen is
    // mandatory and not skippable, which is exactly why its a11y is not optional:
    // an operator who cannot scan a QR or read a code field cannot get in at all.
    const { email, password } = await bootstrapAdminSession(ORIGIN);
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
    }, { email, password });

    await page.goto("/mfa/enroll");
    await page.getByTestId("mfa-qr").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);
  });

  test("011 EARS-12: the TOTP challenge screen passes WCAG 2 A/AA (light)", async ({
    page,
  }) => {
    // The challenge is the screen EVERY admin login after the first passes
    // through, so its a11y is the one that compounds: a code field a screen
    // reader cannot label is a daily lockout, not a one-time one. Reachable only
    // for a principal in `mfa_pending_challenge`, so the scan enrols first and
    // then logs back in — the real arc, not a seeded state.
    const { email, password } = await bootstrapAdminSession(ORIGIN);
    await page.goto("/login");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.getByTestId("login-submit").click();
    await page.waitForURL(/\/mfa\/enroll/, { timeout: 20_000 });
    const secret = (await page.getByTestId("mfa-secret").innerText()).trim();
    await page
      .getByTestId("mfa-enroll-form")
      .getByRole("textbox")
      .fill(totpCode(secret));
    await page.waitForURL(/\/events/, { timeout: 20_000 });

    await page.getByTestId("sign-out").click();
    await page.waitForURL(/\/login/, { timeout: 20_000 });
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.getByTestId("login-submit").click();
    await page.waitForURL(/\/mfa\/challenge/, { timeout: 20_000 });
    await page.getByTestId("mfa-challenge-form").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);

    // …and the same screen carrying its uniform failure Alert, because an error
    // an operator cannot perceive is the same as no error at all.
    await page
      .getByTestId("mfa-challenge-form")
      .getByRole("textbox")
      .fill("000000");
    await page.getByTestId("mfa-error").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);
  });

  test("the event list + create + edit surfaces pass WCAG 2 A/AA (light)", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/events");
    for (const theme of THEMES) await scan(page, theme);

    const id = await createEventForScan(page);
    await page.goto("/events/create");
    for (const theme of THEMES) await scan(page, theme);

    await page.goto(`/events/${id}`);
    await page.getByTestId("event-form").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);
  });
});
