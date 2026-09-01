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
 * 014 EARS-7 (#1344) added the second describe below — the «запись готовится»
 * PLAQUE that occupies the player position while nothing is published, carrying
 * the operator's readiness day when there is one and an honest date-free line
 * when there is not.
 *
 * Out of scope by design — each is its own Issue, and a placeholder standing in
 * for one here would be the banned stub: the player and its login gate (#1343,
 * EARS-5), the raw-original spoiler (#1345, EARS-8). The player FAILURE boundary
 * (EARS-7's second half) ships with #1344 as a unit-tested component
 * (`app/webinars/[slug]/recording-player.test.tsx`) but has no page surface to
 * drive until #1343 mounts it — driving it here would require faking a mount,
 * which is the banned stub.
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
/**
 * An `ended` event with NO published recording — the preparing projection.
 * Carries `recording_expected_by`, so it drives the DATED plaque (014 EARS-7).
 */
const PREPARING_SLUG = process.env.E2E_PREPARING_WEBINAR_SLUG;
/**
 * A second `ended`, nothing-published event whose `recording_expected_by` is
 * NULL — the operator committed to no day. It exists as its own seed because the
 * date-free plaque copy is a distinct product promise, not a formatting branch:
 * the page must say «как только будет готова» rather than invent an estimate.
 */
const PREPARING_UNDATED_SLUG = process.env.E2E_PREPARING_UNDATED_WEBINAR_SLUG;
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

    // The recording meta. It lives in the PLAYER CARD, not in the status card:
    // #1343 mounted the card and the meta moved with it, so the same fact is
    // not stated twice on one screen (the #1697 dedup obligation). For a guest
    // the card is the login gate, and the gate's eyebrow carries the kind.
    await expect(page.getByTestId("recording-meta")).toHaveCount(0);
    const gate = page.getByTestId("recording-gate");
    await expect(gate).toBeVisible();
    await expect(gate).toContainText("Монтаж");

    // The 004 projection still renders whole: title, school, description and the
    // speaker list are the page's substance, not a recording teaser.
    await expect(page.getByRole("heading", { level: 1 })).not.toBeEmpty();
    await expect(page.getByText("О чём эфир", { exact: true })).toBeVisible();
    // `exact` because the sponsor disclaimer prose also contains the word
    // «спикеры» — the assertion is about the section LABEL, not the substring.
    await expect(page.getByText("Спикеры", { exact: true })).toBeVisible();

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
    // The forbidden set is the SOURCE itself — provider names, the carrier field
    // names, and the shape of a provider-scoped embed id (#1134: a 32-hex ref,
    // never a pasted URL). The bare word «provider» is deliberately NOT in this
    // list: React and next-intl ship components called `…Provider`, so matching
    // it asserts against framework internals rather than the product promise.
    for (const forbidden of [
      "rutube",
      "youtube",
      "vk.com",
      "embedRef",
      "embed_ref",
    ]) {
      expect(
        html.toLowerCase(),
        `delivered HTML must not carry «${forbidden}»`,
      ).not.toContain(forbidden.toLowerCase());
    }
    expect(
      html.match(/\b[0-9a-f]{32}\b/i),
      "delivered HTML must not carry a provider-scoped embed ref",
    ).toBeNull();
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
    // No kind/duration meta — there is no recording to describe.
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
    // `exact` — the archive notice card repeats the phrase as «Мероприятие в
    // архиве»; the hero badge is the render 004 EARS-5 owns.
    await expect(page.getByText("В архиве", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Регистрация недоступна", { exact: true }),
    ).toBeVisible();
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

test.describe("014 EARS-7 the «запись готовится» plaque (e2e)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("014 EARS-7: an ended event awaiting its recording shows the plaque in the PLAYER position with the operator's own readiness day", async ({
    page,
    context,
  }) => {
    test.skip(!PREPARING_SLUG, "requires an ended event with no recording");
    await context.clearCookies();
    await page.goto(`${BASE}/webinars/${PREPARING_SLUG}`, {
      waitUntil: "domcontentloaded",
    });

    const plaque = page.getByTestId("recording-plaque");
    await expect(plaque).toBeVisible();
    await expect(plaque).toContainText("Запись готовится");
    // The operator's committed day, formatted for a Russian reader — the whole
    // point of EARS-7. The seed's `recording_expected_by` supplies it; the
    // assertion is on the «до <day> <month>» SHAPE so the seed can move.
    await expect(page.getByTestId("recording-plaque-date")).toHaveText(
      /^до \d{1,2} [а-яё]+( \d{4})?$/,
    );
    await expect(plaque).toContainText("опубликуем на этой странице до");

    // Still no player and no source — the plaque is what stands in the player
    // position, not a frame waiting on something (#1343 owns the mount).
    await expect(page.locator("iframe, video")).toHaveCount(0);
    // No dead affordance: readiness notifications are a declared 014 non-goal,
    // so the canvas's «Напомнить на почту» button must not exist.
    await expect(page.getByText(/Напомнить/)).toHaveCount(0);
    // And no invented estimate — «≈2 дня» is placeholder canvas copy.
    await expect(page.getByText(/≈\s*\d+\s*дн/)).toHaveCount(0);
  });

  test("014 EARS-7: with NO committed day the plaque stays honest — it promises the page, not a date it does not have", async ({
    page,
    context,
  }) => {
    test.skip(
      !PREPARING_UNDATED_SLUG,
      "requires an ended event with no recording and no expected-by day",
    );
    await context.clearCookies();
    await page.goto(`${BASE}/webinars/${PREPARING_UNDATED_SLUG}`, {
      waitUntil: "domcontentloaded",
    });

    const plaque = page.getByTestId("recording-plaque");
    await expect(plaque).toBeVisible();
    await expect(plaque).toContainText("Запись готовится");
    await expect(plaque).toContainText("как только будет готова");
    // Hide-until-content: no date line at all, not an empty slot or a dash.
    await expect(page.getByTestId("recording-plaque-date")).toHaveCount(0);
    await expect(plaque).not.toContainText("до ");
  });

  test("014 EARS-7: a PUBLISHED recording carries no plaque — the promise clears itself the moment it is kept", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto(`${BASE}/webinars/${ENDED_SLUG}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByTestId("recording-plaque")).toHaveCount(0);
    await expect(page.getByText("Запись готовится")).toHaveCount(0);
  });

  test("014 EARS-7: an ARCHIVED event shows no plaque — 004 EARS-5's «в архиве» notice owns that render alone", async ({
    page,
    context,
  }) => {
    test.skip(!ARCHIVED_SLUG, "requires an archived event slug");
    await context.clearCookies();
    await page.goto(`${BASE}/webinars/${ARCHIVED_SLUG}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByTestId("recording-plaque")).toHaveCount(0);
  });
});
