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

/** A draft expert — a name is the only value the create form demands (012 §2.2). */
async function createExpertForScan(page: Page, name: string): Promise<string> {
  await page.goto("/experts/create");
  await page.getByTestId("expert-name").fill(name);
  await page.getByTestId("submit-expert").click();
  await page.waitForURL(/\/experts\/[0-9a-f-]{36}$/);
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
    await expect(
      page.getByText("превышено на", { exact: false }),
    ).toBeVisible();
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

  // 012 EARS-4 (#1286) — the partner vertical. It introduces no new element CLASS
  // (no initials avatar, no character counter), but it does introduce two resting
  // states no other admin surface renders: a media dropzone with NO fallback
  // affordance behind it (an empty logo slot stays empty, §5.2), and a URL field
  // whose reject state is a `pattern` message rather than a length one. Both are
  // colour/naming states an existing green certifies nothing about, so the partner
  // surfaces are enumerated the way the project (#1283) and expert (#1284) scans
  // are rather than inheriting theirs.
  test("the partner list + create + detail surfaces pass WCAG 2 A/AA (light)", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/partners");
    await page.getByTestId("partners-filters").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);

    await page.goto("/partners/create");
    await page.getByTestId("partner-form").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);

    // The REJECTED website field — a destructive inline message plus the field's
    // invalid border, its own colour state and its own accessible-name wiring.
    await page.getByTestId("partner-website-url").fill("example.com");
    await page.getByTestId("submit-partner").click();
    await expect(page.getByTestId("partner-form")).toBeVisible();
    for (const theme of THEMES) await scan(page, theme);

    // A real created row, so the detail scan covers the tab bar and the dropzone's
    // EMPTY slot — the state that has no avatar behind it.
    await page.getByTestId("partner-website-url").fill("https://example.com");
    await page.getByTestId("partner-title").fill(`Axe-скан партнёр ${Date.now()}`);
    await page.getByTestId("submit-partner").click();
    await page.waitForURL(/\/partners\/[0-9a-f-]{36}$/);
    await page.getByTestId("partner-form").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);
  });

  // 014 EARS-1/EARS-2 (#1339) — the «Записи» tab and the modal element class it
  // introduces. The OPEN modal is scanned explicitly, not just the tab behind it:
  // a dialog is a different a11y surface from the page (its own name, its own
  // description, a focus trap and a scrim over everything else), and a suite that
  // only ever scanned the closed trigger would certify nothing about it.
  test("the recordings tab and its modal confirmation pass WCAG 2 A/AA (light)", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const id = await createEventForScan(page);

    await page.goto(`/events/${id}`);
    await page.getByTestId("tab-recordings").click();
    await page.getByTestId("recordings-panel").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);

    // The attach `Dialog` — a form inside a modal, with the walk-away × affordance.
    await page.getByTestId("recording-attach-edited").click();
    await page
      .getByTestId("recording-attach-edited-form")
      .waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);
    await page.keyboard.press("Escape");

    // A row plus its `AlertDialog` confirmation — the must-be-answered variant,
    // whose action pair is the raised-button contract on the card surface.
    await page.getByTestId("recording-attach-edited").click();
    await page
      .getByTestId("recording-attach-edited-provider")
      .selectOption("rutube");
    await page
      .getByTestId("recording-attach-edited-embed-ref")
      .fill("a1b2c3d4e5f60718293a4b5c6d7e8f90");
    await page.getByTestId("recording-attach-edited-submit").click();
    await page
      .getByTestId("recording-status-edited")
      .waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);

    await page.getByTestId("recording-edited-retire").click();
    await page.getByRole("alertdialog").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);
  });

  // 012 EARS-7 (#1289) — the «Эксперты» tab of the event detail. It reuses the
  // recordings tab's modal classes but adds three states no scanned surface holds:
  // a SELECTOR composed of a search box narrowing a `NativeSelect` (two controls
  // that must each carry their own accessible name, not one shared label), a link
  // row whose two `Badge`s carry status and legacy-match state as colour-plus-text,
  // and a form REJECTED inside an open modal — an invalid control and its message
  // living under a focus trap, which the closed-dialog scans certify nothing about.
  test("the event↔expert link tab, its dialog and its confirmations pass WCAG 2 A/AA (light)", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const eventId = await createEventForScan(page);
    const expertName = `Axe-скан эксперт ${Date.now()}`;
    await createExpertForScan(page, expertName);

    // The EMPTY tab first — «пока не привязан ни один эксперт» plus the retired
    // toggle is a resting state a populated panel would hide.
    await page.goto(`/events/${eventId}`);
    await page.getByTestId("tab-experts").click();
    await page.getByTestId("event-experts-panel").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);

    // The add `Dialog` — the selector pair, two text boxes and their hints.
    await page.getByTestId("event-expert-add").click();
    await page
      .getByTestId("event-expert-add-form")
      .waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);

    // The REJECTED form, still inside the modal.
    await page.getByTestId("event-expert-add-position").fill("не число");
    await page.getByTestId("event-expert-add-submit").click();
    await expect(page.getByTestId("event-expert-add-form")).toBeVisible();
    for (const theme of THEMES) await scan(page, theme);

    // A real link, so the row's badges and its action pair are scanned as state,
    // not as an empty-list placeholder.
    await page.getByTestId("event-expert-search").fill(expertName);
    await expect(
      page.getByTestId("event-expert-select").locator("option", {
        hasText: expertName,
      }),
    ).toHaveCount(1);
    await page
      .getByTestId("event-expert-select")
      .selectOption({ label: expertName });
    await page.getByTestId("event-expert-add-role").fill("Модератор");
    await page.getByTestId("event-expert-add-position").fill("1");
    await page.getByTestId("event-expert-add-submit").click();
    await page.getByTestId("event-experts-active").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);

    // The retire `AlertDialog` — the must-be-answered variant on this surface.
    await page
      .locator('[data-testid^="event-expert-"][data-testid$="-retire"]')
      .click();
    await page.getByRole("alertdialog").waitFor({ state: "visible" });
    for (const theme of THEMES) await scan(page, theme);
  });
});
