import { test, expect } from "@playwright/test";

/**
 * 014 EARS-4 — the publicly readable POST-LIVE event page, driven in a browser
 * with no session at all.
 *
 * What this pins, and why each assertion is here rather than in the api suite
 * (`apps/api/test/recordings/public-reads.e2e-spec.ts`, which owns the payload):
 *   • the recording signal actually RENDERS for a guest — the page is complete
 *     server-side HTML, never a client-side reveal behind a soft-wall;
 *   • no playable source reaches the browser — asserted against the delivered
 *     HTML and against the network the page opens, because "the guest cannot
 *     play it" is only true if neither the markup nor a subsequent request
 *     carries an embed;
 *   • ONE route serves it. There is no `/archive/*` mirror and no second
 *     post-live page, so a sponsor-distributed link and an in-product link are
 *     the same URL (design §8.1).
 *
 * Out of scope by design — each is its own Issue, and a placeholder standing in
 * for one here would be the banned stub: the player and its login gate (#1343,
 * EARS-5), the «запись готовится» plaque with the readiness date (#1344,
 * EARS-7), the raw-original spoiler (#1345, EARS-8).
 *
 * Live-stand-gated tier, mirroring `event-page-registered.spec.ts`: it needs a
 * running portal whose `/v1/*` rewrite reaches a running api + Postgres seeded
 * with an `ended` event carrying a PUBLISHED recording. It `test.skip`s unless
 * that env is present, so a stray CI invocation is inert.
 *
 * The leading `014 EARS-4 ` prefix is the ears-test-lint feature scope (a
 * parenthesized mid-title does NOT scope): it binds this file to feature 014.
 */

const BASE = process.env.E2E_PORTAL_URL ?? "http://localhost:3001";
/** An `ended` event whose recording is PUBLISHED (montage). */
const ENDED_SLUG = process.env.E2E_ENDED_WEBINAR_SLUG;
/** An `ended` event with NO published recording — the preparing projection. */
const PREPARING_SLUG = process.env.E2E_PREPARING_WEBINAR_SLUG;
/** An `archived` event — the 004 EARS-5 notice must survive 014 untouched. */
const ARCHIVED_SLUG = process.env.E2E_ARCHIVED_WEBINAR_SLUG;

test.skip(
  !process.env.E2E_PORTAL_URL || !ENDED_SLUG,
  "requires a live portal + an ended event slug with a published recording",
);

test.describe("014 EARS-4 public post-live event page (e2e)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("014 EARS-4: a visitor with NO account sees the post-live page complete — the recording signal and every 004 field, server-rendered", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    const res = await page.goto(`${BASE}/webinars/${ENDED_SLUG}`, {
      waitUntil: "domcontentloaded",
    });
    expect(res?.status()).toBe(200);

    // The one thing a post-live visitor came to find out.
    const badge = page.getByTestId("recording-badge");
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText("Запись доступна");

    // The recording meta — a STATEMENT of what is published, not an affordance
    // (the player is #1343, so there must be no play control to dead-end on).
    const meta = page.getByTestId("recording-meta");
    await expect(meta).toBeVisible();
    await expect(meta).toContainText("Монтаж");

    // The 004 projection still renders whole: title, school, description and the
    // speaker list are the page's substance, not a recording teaser.
    await expect(page.getByRole("heading", { level: 1 })).not.toBeEmpty();
    await expect(page.getByText("О чём эфир")).toBeVisible();
    await expect(page.getByText("Спикеры")).toBeVisible();

    // The exactly-one-CTA invariant holds in the ended state: no participation
    // CTA, and no half-built player button pretending to be one.
    await expect(
      page.getByRole("link", { name: "Участвовать", exact: true }),
    ).toHaveCount(0);
  });

  test("014 EARS-4: not one byte of playable source reaches the guest — not in the HTML, not on the wire", async ({
    page,
    context,
  }) => {
    await context.clearCookies();

    // Anything the page fetches for itself counts too: a source-free body that
    // then XHRs an embed id would satisfy the payload assertion and still hand a
    // guest the video.
    const requested: string[] = [];
    page.on("request", (r) => requested.push(r.url()));

    await page.goto(`${BASE}/webinars/${ENDED_SLUG}`, {
      waitUntil: "networkidle",
    });

    const html = await page.content();
    for (const forbidden of ["rutube", "embedRef", "embed_ref", "provider"]) {
      expect(
        html.toLowerCase(),
        `delivered HTML must not carry «${forbidden}»`,
      ).not.toContain(forbidden.toLowerCase());
    }
    // No player frame of any kind was mounted.
    await expect(page.locator("iframe, video")).toHaveCount(0);
    expect(
      requested.filter((u) => /rutube|youtube|vk\.com|cdnvideo/i.test(u)),
      "the page must not reach a video provider for a guest",
    ).toEqual([]);
  });

  test("014 EARS-4: an ended event with nothing published yet says «Запись готовится» and names no kind — it never claims a recording it does not have", async ({
    page,
    context,
  }) => {
    test.skip(!PREPARING_SLUG, "requires an ended event with no recording");
    await context.clearCookies();
    await page.goto(`${BASE}/webinars/${PREPARING_SLUG}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByTestId("recording-badge")).toHaveText(
      "Запись готовится",
    );
    // No kind/duration meta — there is no recording to describe. (The plaque
    // carrying the readiness DATE is #1344; its absence here is the scope line,
    // not an oversight.)
    await expect(page.getByTestId("recording-meta")).toHaveCount(0);
  });

  test("014 EARS-4: an ARCHIVED event keeps the 004 EARS-5 «в архиве» render untouched — no recording badge competing with the notice", async ({
    page,
    context,
  }) => {
    test.skip(!ARCHIVED_SLUG, "requires an archived event slug");
    await context.clearCookies();
    const res = await page.goto(`${BASE}/webinars/${ARCHIVED_SLUG}`, {
      waitUntil: "domcontentloaded",
    });
    // Degrades in place — never a 404 or a redirect (004 EARS-5, owner variant «а»).
    expect(res?.status()).toBe(200);
    await expect(page.getByText("В архиве")).toBeVisible();
    await expect(page.getByText("Регистрация недоступна")).toBeVisible();
    await expect(page.getByTestId("recording-badge")).toHaveCount(0);
    await expect(page.getByTestId("recording-meta")).toHaveCount(0);
  });

  test("014 EARS-4: ONE route serves the post-live page — no /archive mirror, no second post-live URL", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    for (const mirror of [
      `/archive/${ENDED_SLUG}`,
      `/webinars/${ENDED_SLUG}/archive`,
      `/webinars/${ENDED_SLUG}/recording`,
    ]) {
      const res = await page.goto(`${BASE}${mirror}`, {
        waitUntil: "domcontentloaded",
      });
      expect(
        res?.status(),
        `${mirror} must not exist — /webinars/:slug is the single route`,
      ).toBe(404);
    }
  });
});
