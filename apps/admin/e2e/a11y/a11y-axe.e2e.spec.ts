import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { bootstrapAdminSession } from "../support/admin-session";

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

async function loginAsAdmin(page: Page): Promise<string> {
  const { email, password } = await bootstrapAdminSession(ORIGIN);
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await page.waitForTimeout(2500);
    await page.goto("/login");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.getByTestId("login-submit").click();
    try {
      await page.waitForURL(/\/events/, { timeout: 8000 });
      return password;
    } catch {
      /* role not yet projected — retry */
    }
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
