import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PROJECT_DESCRIPTION_MAX } from "@ds/schemas";
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

  // The 011 MFA screens' scan lives in `mfa-a11y.e2e.spec.ts`, with the i18n half
  // of EARS-12 it fails together with — this file is the 007 event surface.

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

  // 012 EARS-1 (#1283) — the taxonomy surfaces added by the project vertical: the
  // shared admin list shell (search box, state select, retired toggle, pagination)
  // and the tabbed detail with the character counter and the media dropzone. They
  // introduce four control classes the event surfaces never had, so they get their
  // own scan rather than inheriting a green from the event pages.
  test("the project list + create + detail surfaces pass WCAG 2 A/AA (light)", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/projects");
    await page.getByTestId("projects-filters").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);

    await page.goto("/projects/create");
    await page.getByTestId("project-form").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);

    // The OVER-LIMIT counter is its own colour state (destructive small text), so
    // it is scanned explicitly rather than inherited from the resting form: the
    // showcase `playwright-axe` gate caught a real `color-contrast` failure there,
    // and a suite that only ever renders the muted counter would not have.
    await page
      .locator("#description")
      .fill("х".repeat(PROJECT_DESCRIPTION_MAX + 5));
    await expect(page.getByText("превышено на", { exact: false })).toBeVisible();
    for (const theme of THEMES) await scan(page, theme);

    // A real created row, so the detail scan covers the tab bar, the populated
    // counter and the dropzone's filled state — not just an empty form.
    await page.locator("#title").fill(`Axe-скан проект ${Date.now()}`);
    await page.locator("#description").fill("");
    await page.locator("#description").fill("Описание для скана доступности.");
    await page.getByTestId("submit-project").click();
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
    await page.getByTestId("project-form").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);
  });

  // 012 EARS-2 (#1284) — the expert vertical. It reuses the shared list shell and
  // the dropzone the project scan already covers, but it adds one control class no
  // other admin surface renders: the initials AVATAR (a `primary-action` fill with
  // `primary-foreground` text, carrying an `aria-label` as its only accessible
  // name). A contrast or naming regression there would pass every existing scan,
  // so the expert surfaces get their own.
  test("the expert list + create + detail surfaces pass WCAG 2 A/AA (light)", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/experts");
    await page.getByTestId("experts-filters").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);

    await page.goto("/experts/create");
    await page.getByTestId("expert-form").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);

    // A real created row, so the detail scan covers the tab bar, the populated
    // counters and — the point of this test — the rendered initials avatar.
    await page.locator("#name").fill(`Пётр Аксёнов ${Date.now()}`);
    await page.locator("#professionalRole").fill("Кардиолог");
    await page.locator("#bio").fill("Биография для скана доступности.");
    await page.getByTestId("submit-expert").click();
    await page.waitForURL(/\/experts\/[0-9a-f-]{36}$/);
    await page.getByTestId("expert-form").waitFor({ state: "visible" });
    await page.getByTestId("expert-initials").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);
  });
});
