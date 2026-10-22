import AxeBuilder from "@axe-core/playwright";
import {
  MAIN_LANDMARK_RULES,
  eventPageHonestyFindings,
  offlineSoldOutFindings,
} from "@ds/e2e";
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
  await page.screenshot({
    path: join(SHOT_DIR, `${name}.png`),
    fullPage: true,
  });
}

// Gate row 30 (D9, 004 «Amendment — 2026-10-02»): the browser runs in Asia/Yekaterinburg.
// After hydration an online or hybrid event states its time in that zone with
// its label; an offline event stays МСК. The server bytes stay МСК.
async function expectedZoneLabel(page: Page): Promise<string> {
  const kicker =
    (await page.getByTestId("event-page-kicker").textContent()) ?? "";
  return /Очно/u.test(kicker) ? "МСК" : "GMT+5";
}

test.describe("020 EARS-2 — the registration-free decision set", () => {
  test.use({ timezoneId: "Asia/Yekaterinburg" });
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
    await expect(page.getByTestId("event-page-hero")).toContainText(
      `(${await expectedZoneLabel(page)})`,
    );
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
    await expect(
      openPart.getByTestId("event-speaker-card").first(),
    ).toBeVisible();

    // ── «absent rather than dead» (spec L190) ────────────────────────────
    // Every anchor in the open part resolves somewhere real: no empty href, no
    // `#` placeholder, no `javascript:` stub.
    const hrefs = await openPart
      .locator("a")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
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
    await page.goto(`${BASE}/events/${SLUG}`, {
      waitUntil: "domcontentloaded",
    });
    // A speaker photo is a presigned object-storage URL minted per request:
    // its signing instant and signature differ between ANY two reads, guest or
    // not (#2996 — the stand's speakers carry photos). Those request nonces are
    // blanked; every other byte, the object key included, must still match.
    const unsigned = (html: string) =>
      html.replace(/(X-Amz-(?:Date|Signature))=[^&"]*/gu, "$1=");
    const guest = unsigned(
      await page.getByTestId("event-page-open-part").innerHTML(),
    );

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
    await page.goto(`${BASE}/events/${SLUG}`, {
      waitUntil: "domcontentloaded",
    });
    const withSession = unsigned(
      await page.getByTestId("event-page-open-part").innerHTML(),
    );

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
    await page.goto(`${BASE}/events/${SLUG}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("event-page-open-part")).toBeVisible();

    const results = await new AxeBuilder({ page })
      .options({ rules: MAIN_LANDMARK_RULES })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      // #2189 / #2180 — the shared shell's two leaf-scoped decorations: the BBM
      // topbar (owner-accepted canvas contrast) and the footer's aria-hidden
      // giant wordmark (its accessible form is the logo image beside it).
      .exclude('[data-testid="shell-topbar"]')
      .exclude('[data-testid="footer-giant"]')
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
    await page.goto(`${BASE}/events/${SLUG}`, {
      waitUntil: "domcontentloaded",
    });
    const download = page.getByTestId("event-programme").getByRole("link");
    if ((await download.count()) > 0) {
      await download.first().focus();
      await download.first().hover();
      await shoot(page, "doctor-event-page-programme-link-focus");
    }
  });
});

/**
 * Wave-3 PR 3.3 (#2072) — the format block, the seats statement and the
 * EARS-19 honest-state sweep on the live stand (gate rows 33, 34, 38, 40, 41).
 *
 * Env (each block skips without its own):
 *   E2E_SWEEP_SLUGS          comma-separated slugs covering format × phase
 *                            (online / offline / hybrid · upcoming / ended …)
 *   E2E_HYBRID_SLUG          a hybrid event with seats left
 *   E2E_HYBRID_SOLDOUT_SLUG  a hybrid event with `seats_left = 0`
 *   E2E_OFFLINE_SOLDOUT_SLUG a pure offline event with `seats_left = 0`
 */
const SWEEP_SLUGS = (process.env.E2E_SWEEP_SLUGS ?? "")
  .split(",")
  .map((slug) => slug.trim())
  .filter(Boolean);
const HYBRID_SLUG = process.env.E2E_HYBRID_SLUG;
const HYBRID_SOLDOUT_SLUG = process.env.E2E_HYBRID_SOLDOUT_SLUG;
const OFFLINE_SOLDOUT_SLUG = process.env.E2E_OFFLINE_SOLDOUT_SLUG;

test.describe("020 EARS-8/9/19 — wave-3 PR 3.3 on the doctor host", () => {
  test.use({ timezoneId: "Asia/Yekaterinburg" });
  test.skip(!BASE, "requires a live doctor app");

  test("020 EARS-19: a state sweep over format × phase × auth finds no «скоро», no empty labelled box, no disabled control and no Pul statement", async ({
    page,
    context,
  }) => {
    test.skip(SWEEP_SLUGS.length === 0, "set E2E_SWEEP_SLUGS");
    for (const slug of SWEEP_SLUGS) {
      for (const auth of ["guest", "session"] as const) {
        await context.clearCookies();
        if (auth === "session") {
          await context.addCookies([
            {
              name: "__Host-ds_session",
              value: "e2e-honesty-sweep-probe",
              domain: new URL(BASE!).hostname,
              path: "/",
              secure: true,
            },
          ]);
        }
        const response = await page.goto(`${BASE!}/events/${slug}`, {
          waitUntil: "domcontentloaded",
        });
        expect(response?.status(), slug).toBe(200);
        await expect(page.getByTestId("event-page-open-part")).toBeVisible();
        expect(
          await eventPageHonestyFindings(page),
          `${slug} · ${auth}`,
        ).toEqual([]);
      }
    }
  });

  test("020 EARS-8: the hybrid tab is written to the URL, survives reload and back, and defaults to the policy's half", async ({
    page,
    context,
  }) => {
    test.skip(!HYBRID_SLUG, "set E2E_HYBRID_SLUG");
    await context.clearCookies();
    await page.setViewportSize(DESKTOP);
    await page.goto(`${BASE!}/events/${HYBRID_SLUG}`, {
      waitUntil: "domcontentloaded",
    });
    const tabs = page.getByTestId("event-format-tabs");
    // Seats remain → the policy offers registration → «очно» by default.
    await expect(tabs).toHaveAttribute("data-mode", "offline");
    await expect(page.getByTestId("event-format-seats")).toBeVisible();

    await page.getByRole("tab", { name: "Онлайн" }).click();
    await expect(page).toHaveURL(/[?&]mode=online\b/u);
    await expect(tabs).toHaveAttribute("data-mode", "online");
    await shoot(page, "doctor-hybrid-tab-online-desktop-light");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("event-format-tabs")).toHaveAttribute(
      "data-mode",
      "online",
    );
    // LD-9 — the guest's registration handoff returns to the tab.
    const handoff = page
      .getByTestId("event-signup-card")
      .locator('a[href*="returnTo"]')
      .first();
    const href = (await handoff.getAttribute("href")) ?? "";
    expect(new URL(href, BASE!).searchParams.get("returnTo")).toBe(
      `/events/${HYBRID_SLUG}?mode=online`,
    );

    // Keyboard: arrow keys move between the tabs and the URL follows.
    await page.getByRole("tab", { name: "Онлайн" }).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page).toHaveURL(/[?&]mode=offline\b/u);
    await expect(page.getByRole("tab", { name: "Очно" })).toBeFocused();
    await shoot(page, "doctor-hybrid-tab-keyboard-focus-desktop-light");

    // Back moves between tabs, not off the page.
    await page.goBack();
    await expect(page).toHaveURL(/[?&]mode=online\b/u);
    await expect(page.getByTestId("event-format-tabs")).toHaveAttribute(
      "data-mode",
      "online",
    );
  });

  test("020 EARS-9: a hybrid event with no seats opens on «онлайн» and says why", async ({
    page,
    context,
  }) => {
    test.skip(!HYBRID_SOLDOUT_SLUG, "set E2E_HYBRID_SOLDOUT_SLUG");
    await context.clearCookies();
    await page.goto(`${BASE!}/events/${HYBRID_SOLDOUT_SLUG}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("event-format-tabs")).toHaveAttribute(
      "data-mode",
      "online",
    );
    await expect(page.getByTestId("event-format-statement")).toContainText(
      "Очных мест не осталось",
    );
  });

  test("020 EARS-9: a sold-out offline event renders «мест нет», no control and no waiting-list affordance (gate row 35)", async ({
    page,
    context,
  }) => {
    test.skip(!OFFLINE_SOLDOUT_SLUG, "set E2E_OFFLINE_SOLDOUT_SLUG");
    for (const auth of ["guest", "session"] as const) {
      await context.clearCookies();
      if (auth === "session") {
        await context.addCookies([
          {
            name: "__Host-ds_session",
            value: "e2e-honesty-sweep-probe",
            domain: new URL(BASE!).hostname,
            path: "/",
            secure: true,
          },
        ]);
      }
      await page.goto(`${BASE!}/events/${OFFLINE_SOLDOUT_SLUG}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByTestId("event-format-seats")).toHaveText(
        "Мест не осталось",
      );
      expect(await offlineSoldOutFindings(page), auth).toEqual([]);
    }
  });

  test("Stage-B evidence: every swept state at desktop and mobile in light and dark", async ({
    page,
    context,
  }) => {
    test.skip(!SHOT_DIR || SWEEP_SLUGS.length === 0, "evidence capture");
    await context.clearCookies();
    for (const slug of SWEEP_SLUGS) {
      for (const shot of [
        { name: "desktop-light", size: DESKTOP, theme: "light" },
        { name: "desktop-dark", size: DESKTOP, theme: "dark" },
        { name: "mobile-light", size: MOBILE, theme: "light" },
        { name: "mobile-dark", size: MOBILE, theme: "dark" },
      ] as const) {
        await page.setViewportSize(shot.size);
        await page.emulateMedia({ colorScheme: shot.theme });
        await page.goto(`${BASE!}/events/${slug}`, {
          waitUntil: "domcontentloaded",
        });
        await page.evaluate((theme) => {
          document.documentElement.classList.toggle("dark", theme === "dark");
        }, shot.theme);
        await expect(page.getByTestId("event-page-open-part")).toBeVisible();
        await shoot(page, `doctor-${slug}-${shot.name}`);
      }
    }
  });
});
