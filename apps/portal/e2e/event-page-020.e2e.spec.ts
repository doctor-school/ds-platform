import { eventPageHonestyFindings } from "@ds/e2e";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * 020 EARS-1 (#1764, slice 3) — the academy storefront's mount of the ONE shared
 * event page. `apps/portal/app/webinars/[slug]/(event-page)/page.tsx` no longer composes a
 * host-local page: it is `EventPageShell` / `EventPageHero` / `EventSignupCard` /
 * `EventSpeakerCard` / `EventFormatBlock` over `EventPageView` plus the
 * server-resolved `ParticipationCta`.
 *
 * This pins the `020-scenarios.feature` L26–46 subset a GUEST must get: the page
 * is server-rendered with no authentication, carries the title, the kicker, the
 * date + time «МСК» line, the specialty chips, the «О чём событие» body and the
 * speakers, and the right column is the sticky sign-up card with EXACTLY ONE
 * primary «Участвовать» CTA. The 021 round-trip / registered card / room entry
 * rows are EARS-5/6/7 and out of this slice.
 *
 * Live-stand-gated tier (mirrors `event-page.e2e.spec.ts`): a running portal
 * whose `/v1/*` rewrite reaches a running api + Postgres seeded with a
 * `published` event. `test.skip`s unless `E2E_PORTAL_URL` + `E2E_WEBINAR_SLUG`
 * are provided, so a stray CI invocation is inert.
 */

const BASE = process.env.E2E_PORTAL_URL ?? "http://localhost:3001";
const SLUG = process.env.E2E_WEBINAR_SLUG;
const SLUG_ENDED = process.env.E2E_WEBINAR_SLUG_ENDED;

test.skip(
  !process.env.E2E_PORTAL_URL || !SLUG,
  "requires a live portal + a seeded event slug",
);
test.use({ timezoneId: "Asia/Yekaterinburg" });

// Gate row 30 (D9, 004 «Amendment — 2026-10-02»): the browser runs in Asia/Yekaterinburg.
// After hydration an online or hybrid event states its time in that zone with
// its label; an offline event stays МСК. The server bytes stay МСК.
async function expectedZoneLabel(page: Page): Promise<string> {
  const kicker =
    (await page.getByTestId("event-page-kicker").textContent()) ?? "";
  return /Очно/u.test(kicker) ? "МСК" : "GMT+5";
}

test("020 EARS-1: a guest reads the whole event server-side, composed from the shared blocks", async ({
  page,
  context,
}) => {
  await context.clearCookies();

  const response = await page.goto(`${BASE}/webinars/${SLUG}`, {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBe(200);

  // The shared composition, not a host-local one.
  await expect(page.getByTestId("event-page-shell")).toBeVisible();
  await expect(page.getByTestId("event-page-hero")).toBeVisible();
  await expect(page.getByTestId("event-page-main")).toBeVisible();

  // Title + kicker + the date/time line, all in the hero.
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  await expect(page.getByTestId("event-page-hero")).toContainText(
    `(${await expectedZoneLabel(page)})`,
  );

  // Specialty chips (the read model's `specialties`).
  await expect(page.getByTestId("event-page-hero-chips")).toBeVisible();

  // The body the guest came for.
  await expect(page.getByTestId("event-about")).toBeVisible();
  await expect(page.getByTestId("event-speaker-card").first()).toBeVisible();

  // No soft-wall of any kind — the page is public.
  await expect(page.locator("body")).not.toContainText(
    /авторизуйтесь|войдите для просмотра/i,
  );
});

test("020 EARS-1: the right column is the sign-up card with exactly one primary CTA for a guest", async ({
  page,
  context,
}) => {
  await context.clearCookies();
  await page.goto(`${BASE}/webinars/${SLUG}`, {
    waitUntil: "domcontentloaded",
  });

  const aside = page.getByTestId("event-page-aside");
  await expect(aside).toBeVisible();
  const card = page.getByTestId("event-signup-card");
  await expect(card).toHaveCount(1);
  // The server-resolved action the card renders verbatim.
  await expect(card).toHaveAttribute("data-cta-action", "register");

  // EXACTLY ONE «Участвовать» on the whole page, and it carries the event
  // context into the 003 registration entry — the href the SERVER resolved.
  const cta = page.getByRole("link", { name: "Участвовать", exact: true });
  await expect(cta).toHaveCount(1);
  await expect(cta).toHaveAttribute(
    "href",
    `/register?returnTo=${encodeURIComponent(`/webinars/${SLUG}`)}`,
  );
});

test("020 EARS-1: the page is complete HTML from the server — the CTA is in the raw bytes, not injected by client JS", async ({
  request,
}) => {
  const res = await request.get(`${BASE}/webinars/${SLUG}`);
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toContain("МСК");
  expect(html).toContain("Участвовать");
  // The «О чём событие» heading the owner asked for at Stage B (#1779): both
  // hosts now default to it. Copy defaults stay per-host overridable — that is
  // what 020 EARS-18 (#1764) lets the two hosts differ on — the academy simply
  // no longer overrides this one.
  expect(html).toContain("О чём событие");
});

test("020 EARS-1: an ended event renders the same composition with NO participation control (never a dead link)", async ({
  page,
  context,
}) => {
  test.skip(!SLUG_ENDED, "requires a seeded ended event");
  await context.clearCookies();

  const response = await page.goto(`${BASE}/webinars/${SLUG_ENDED}`, {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBe(200);

  await expect(page.getByTestId("event-page-shell")).toBeVisible();
  await expect(page.getByTestId("event-signup-card")).toHaveCount(1);
  // The server said `unavailable`; the shared card renders words, not a control.
  await expect(page.getByTestId("event-signup-cta")).toHaveCount(0);
  for (const dead of ["Участвовать", "Записаться", "Смотреть эфир"]) {
    await expect(
      page.getByRole("link", { name: dead, exact: true }),
    ).toHaveCount(0);
  }
});

/** `E2E_SHOT_DIR` opts into the Stage-B evidence PNGs; unset, the spec still asserts. */
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

/**
 * Wave-3 PR 3.3 (#2072) — the format block, the seats statement and the
 * EARS-19 honest-state sweep on the live stand (gate rows 33, 34, 38, 40, 41).
 *
 * Env (each block skips without its own):
 *   E2E_SWEEP_SLUGS          comma-separated slugs covering format × phase
 *                            (online / offline / hybrid · upcoming / ended …)
 *   E2E_HYBRID_SLUG          a hybrid event with seats left
 *   E2E_HYBRID_SOLDOUT_SLUG  a hybrid event with `seats_left = 0`
 */
const SWEEP_SLUGS = (process.env.E2E_SWEEP_SLUGS ?? "")
  .split(",")
  .map((slug) => slug.trim())
  .filter(Boolean);
const HYBRID_SLUG = process.env.E2E_HYBRID_SLUG;
const HYBRID_SOLDOUT_SLUG = process.env.E2E_HYBRID_SOLDOUT_SLUG;

test.describe("020 EARS-8/9/19 — wave-3 PR 3.3 on the academy host", () => {
  test.use({ timezoneId: "Asia/Yekaterinburg" });
  test.skip(!process.env.E2E_PORTAL_URL, "requires a live academy app");

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
              domain: new URL(BASE).hostname,
              path: "/",
              secure: true,
            },
          ]);
        }
        const response = await page.goto(`${BASE}/webinars/${slug}`, {
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
    await page.goto(`${BASE}/webinars/${HYBRID_SLUG}`, {
      waitUntil: "domcontentloaded",
    });
    const tabs = page.getByTestId("event-format-tabs");
    // Seats remain → the policy offers registration → «очно» by default.
    await expect(tabs).toHaveAttribute("data-mode", "offline");
    await expect(page.getByTestId("event-format-seats")).toBeVisible();

    await page.getByRole("tab", { name: "Онлайн" }).click();
    await expect(page).toHaveURL(/[?&]mode=online\b/u);
    await expect(tabs).toHaveAttribute("data-mode", "online");
    await shoot(page, "academy-hybrid-tab-online-desktop-light");

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
    expect(new URL(href, BASE).searchParams.get("returnTo")).toBe(
      `/webinars/${HYBRID_SLUG}?mode=online`,
    );

    // Keyboard: arrow keys move between the tabs and the URL follows.
    await page.getByRole("tab", { name: "Онлайн" }).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page).toHaveURL(/[?&]mode=offline\b/u);
    await expect(page.getByRole("tab", { name: "Очно" })).toBeFocused();
    await shoot(page, "academy-hybrid-tab-keyboard-focus-desktop-light");

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
    await page.goto(`${BASE}/webinars/${HYBRID_SOLDOUT_SLUG}`, {
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
        await page.goto(`${BASE}/webinars/${slug}`, {
          waitUntil: "domcontentloaded",
        });
        await page.evaluate((theme) => {
          document.documentElement.classList.toggle("dark", theme === "dark");
        }, shot.theme);
        await expect(page.getByTestId("event-page-open-part")).toBeVisible();
        await shoot(page, `academy-${slug}-${shot.name}`);
      }
    }
  });
});
