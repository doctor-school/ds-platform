import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * 020 EARS-2 (#1765, slice 1) — the registration-free decision set.
 *
 * The verification row for EARS-2 (`020-requirements-en.md` L251): a guest must
 * be able to DECIDE about the event without registering, and nothing in that
 * open part may be a dead control. This is the live twin of the unit tiers —
 * the schema/resolver/mapper specs pin that a missing target yields an ABSENT
 * key, and this spec pins what that means on the rendered page: plain speaker
 * names and a plain school kicker rather than links to nowhere.
 *
 * Live-stand-gated exactly like its sibling `event-page.spec.ts`: it starts
 * nothing, `test.skip`s when the stand env is absent, and so is inert in CI.
 *
 * Run against a provisioned stand (after `pnpm --filter @ds/doctor build`):
 *   E2E_DOCTOR_URL=http://localhost:3004 E2E_API_URL=http://localhost:3000 \
 *   E2E_WEBINAR_SLUG=seed-005-upcoming E2E_SHOT_DIR=.github/ui-evidence/1765 \
 *   pnpm --filter @ds/doctor exec playwright test \
 *     --config=playwright.event-page.config.ts e2e/event-page-open-part.spec.ts
 */

const BASE = process.env.E2E_DOCTOR_URL;
const SLUG = process.env.E2E_WEBINAR_SLUG;

/**
 * `E2E_SHOT_DIR` opts into the Stage-B evidence PNGs the PR body cites; unset,
 * the spec still asserts — the images are evidence for a human, not the gate.
 */
const SHOT_DIR = process.env.E2E_SHOT_DIR;

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

async function shoot(page: Page, name: string) {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(SHOT_DIR, `${name}.png`), fullPage: true });
}

test.describe("020 EARS-2 — the registration-free decision set", () => {
  test.skip(!BASE || !SLUG, "requires a live doctor app + a seeded event slug");

  test("020 EARS-2.6: a guest reads the complete decision set in canvas order, and the open part carries no dead link", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.setViewportSize(DESKTOP);
    const response = await page.goto(`${BASE}/events/${SLUG}`, {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBe(200);

    // ── the decision set, in the canvas's reading order ──────────────────
    await expect(page.getByTestId("event-page-kicker")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("event-page-hero")).toContainText("МСК");
    await expect(page.getByTestId("event-page-hero-chips")).toBeVisible();

    const openPart = page.getByTestId("event-page-open-part");
    await expect(openPart).toBeVisible();
    await expect(openPart.getByTestId("event-about")).toBeVisible();
    // EARS-19: the programme section ALWAYS renders — the download when a PDF
    // is attached, otherwise the honest lifecycle sentence. No omitted section,
    // no empty labelled box.
    const programme = openPart.getByTestId("event-programme");
    await expect(programme).toBeVisible();
    const download = programme.getByRole("link");
    const statement = programme.getByTestId("event-programme-statement");
    expect(
      (await download.count()) + (await statement.count()),
    ).toBeGreaterThan(0);
    await expect(openPart.getByTestId("event-speaker-card").first()).toBeVisible();

    // ── «absent rather than dead» (spec L190) ────────────────────────────
    // Every anchor in the open part resolves somewhere real: no empty href, no
    // `#` placeholder, no `javascript:` stub.
    const hrefs = await openPart.locator("a").evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("href")),
    );
    for (const href of hrefs) {
      expect(href, "an open-part anchor with no href").toBeTruthy();
      expect(href?.trim()).not.toBe("");
      expect(href?.trim()).not.toBe("#");
      expect(href?.trim().toLowerCase().startsWith("javascript:")).toBe(false);
    }

    // No expert page exists on either host today, so a speaker NAME is plain
    // text — the read model omits the key rather than shipping a dead link.
    // When `#d-expert` ships, `links.speakerPages` fills and this flips by
    // design; the assertion is the honest record of TODAY's shipped behaviour.
    const speakerNames = openPart
      .getByTestId("event-speaker-card")
      .getByRole("heading");
    for (let i = 0; i < (await speakerNames.count()); i += 1) {
      await expect(speakerNames.nth(i).locator("a")).toHaveCount(0);
    }

    await shoot(page, "doctor-event-page-desktop-light");
  });

  test("020 EARS-2.7: the open part is identical for a guest and for a viewer carrying a session", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto(`${BASE}/events/${SLUG}`, { waitUntil: "domcontentloaded" });
    const guest = await page
      .getByTestId("event-page-open-part")
      .innerHTML();

    // The open part is the host's projection of a `@Public()` read: `links` are
    // resolved from the HOST's route table, never from the viewer. A session
    // cookie must therefore change nothing left of the aside (the aside's CTA
    // is the principal-dependent half, and is deliberately excluded).
    await context.addCookies([
      {
        name: "__Host-ds_session",
        value: "e2e-open-part-probe",
        // `__Host-` is origin-locked by specification: no `Domain`, `Path=/`,
        // `Secure` — and http://localhost counts as a secure context.
        domain: "localhost",
        path: "/",
        secure: true,
      },
    ]);
    await page.goto(`${BASE}/events/${SLUG}`, { waitUntil: "domcontentloaded" });
    const withSession = await page
      .getByTestId("event-page-open-part")
      .innerHTML();

    expect(withSession).toBe(guest);
  });

  /**
   * The `playwright-axe` BLOCK gate scans what a backend-free build can reach;
   * the event page is not one of those surfaces — it only exists with a real api
   * behind it. So its WCAG 2 A/AA scan lives HERE, in the live tier, where the
   * composed page actually renders. No rule is allowlisted or excluded: a real
   * violation is fixed on the surface, never scanned away.
   */
  test("020 EARS-2: the composed event page passes WCAG 2 A/AA", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.setViewportSize(DESKTOP);
    await page.goto(`${BASE}/events/${SLUG}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("event-page-open-part")).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);

    // The empty-shell sentinel its portal/doctor siblings carry: exactly one
    // non-empty `h1`, so a page that rendered nothing cannot be axe-clean.
    const h1 = page.locator("h1");
    await expect(h1).toHaveCount(1);
    expect((await h1.innerText()).trim().length).toBeGreaterThan(0);
  });

  /**
   * Stage-B evidence, not a gate: the four presentations the PR body cites, plus
   * the one interactive element the open part owns (the programme download link
   * when a PDF is attached — otherwise the honest statement, which has no
   * interaction). Runs only when `E2E_SHOT_DIR` is set.
   */
  test("020 EARS-2: the open part renders at desktop and mobile in light and dark", async ({
    page,
    context,
  }) => {
    test.skip(!SHOT_DIR, "evidence capture — set E2E_SHOT_DIR to opt in");
    await context.clearCookies();

    for (const shot of [
      { name: "desktop-light", size: DESKTOP, theme: "light" },
      { name: "desktop-dark", size: DESKTOP, theme: "dark" },
      { name: "mobile-light", size: MOBILE, theme: "light" },
      { name: "mobile-dark", size: MOBILE, theme: "dark" },
    ] as const) {
      await page.setViewportSize(shot.size);
      await page.emulateMedia({ colorScheme: shot.theme });
      await page.goto(`${BASE}/events/${SLUG}`, {
        waitUntil: "domcontentloaded",
      });
      await page.evaluate((theme) => {
        document.documentElement.classList.toggle("dark", theme === "dark");
      }, shot.theme);
      await expect(page.getByTestId("event-page-open-part")).toBeVisible();
      await shoot(page, `doctor-event-page-${shot.name}`);
    }

    // The interaction shot: the programme download link on hover/focus when the
    // fixture carries a PDF; with no PDF the section is the honest statement and
    // there is nothing to hover — recorded as `N/A` in the PR body instead.
    await page.setViewportSize(DESKTOP);
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(`${BASE}/events/${SLUG}`, { waitUntil: "domcontentloaded" });
    const download = page.getByTestId("event-programme").getByRole("link");
    if ((await download.count()) > 0) {
      await download.first().focus();
      await download.first().hover();
      await shoot(page, "doctor-event-page-programme-link-focus");
    }
  });
});
