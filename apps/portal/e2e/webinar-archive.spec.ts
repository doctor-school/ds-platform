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
 *   • ONE route serves it. There is no `/hide/*` mirror and no second
 *     post-live page, so a sponsor-distributed link and an in-product link are
 *     the same URL (design §8.1).
 *
 * 014 EARS-7 (#1344) added the second describe below — the «запись готовится»
 * PLAQUE that occupies the player position while nothing is published, carrying
 * the operator's readiness day when there is one and an honest date-free line
 * when there is not.
 *
 * 014 EARS-5 (#1343) added the third describe: the login gate a guest gets in
 * the player position, the mounted player a signed-in doctor gets from the same
 * URL, and the player FAILURE boundary — which #1344 could only unit-test
 * (`app/webinars/[slug]/recording-player.test.tsx`) because nothing mounted the
 * component yet.
 *
 * Out of scope by design — its own Issue, and a placeholder standing in for it
 * here would be the banned stub: the raw-original spoiler (#1345, EARS-8).
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
/** A `hidden` event — the 004 EARS-5 notice must survive 014 untouched. */
const HIDDEN_SLUG = process.env.E2E_HIDDEN_WEBINAR_SLUG;
/**
 * A real doctor account on the same stand (014 EARS-5). The signed-in half of
 * the gate cannot be faked: the whole point is that the SOURCE only exists in a
 * response the api authorized, so the browser has to carry a real session
 * through the real 003 login — a seeded cookie would prove nothing about the
 * gate the api enforces.
 */
const DOCTOR_EMAIL = process.env.E2E_DOCTOR_EMAIL;
const DOCTOR_PASSWORD = process.env.E2E_DOCTOR_PASSWORD;

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

  test("014 EARS-4: a HIDDEN event keeps the 004 EARS-5 «скрыт» render untouched — no recording badge competing with the notice", async ({
    page,
    context,
  }) => {
    test.skip(!HIDDEN_SLUG, "requires a hidden event slug");
    await context.clearCookies();
    const res = await page.goto(`${BASE}/webinars/${HIDDEN_SLUG}`, {
      waitUntil: "domcontentloaded",
    });
    // Degrades in place — never a 404 or a redirect (004 EARS-5, owner variant «а»).
    expect(res?.status()).toBe(200);
    // `exact` — the hidden notice card repeats the phrase as «Мероприятие
    // скрыто»; the hero badge is the render 004 EARS-5 owns.
    await expect(page.getByText("Скрыт", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Регистрация недоступна", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("recording-badge")).toHaveCount(0);
    await expect(page.getByTestId("recording-meta")).toHaveCount(0);
  });

  test("014 EARS-4: ONE route serves the post-live page — no /hide mirror, no second post-live URL", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    for (const mirror of [
      `/hide/${ENDED_SLUG}`,
      `/webinars/${ENDED_SLUG}/hide`,
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

  test("014 EARS-7: a HIDDEN event shows no plaque — 004 EARS-5's «скрыт» notice owns that render alone", async ({
    page,
    context,
  }) => {
    test.skip(!HIDDEN_SLUG, "requires a hidden event slug");
    await context.clearCookies();
    await page.goto(`${BASE}/webinars/${HIDDEN_SLUG}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByTestId("recording-plaque")).toHaveCount(0);
  });
});

/**
 * 014 EARS-5 — the LOGIN GATE and the playback behind it, driven end-to-end.
 *
 * This is the describe that makes the read split real. Everything below the api
 * boundary is already pinned by `apps/api/test/recordings/public-reads.e2e-spec.ts`
 * (source-free public read, 401 without a session, nulls for `preparing`); what
 * only a browser can prove is the pair of renders that read split produces on one
 * URL: the gate a guest gets, and the mounted player a signed-in doctor gets from
 * the same route with nothing but a session cookie changed.
 *
 * The failure boundary is driven here rather than left to the component unit test
 * because #1697 shipped `recording-player.tsx` UNMOUNTED — its retry card was
 * unit-true but had no page to fail on. Two failure shapes, deliberately both:
 * the LOUD one (the provider frame fires `error`) and the QUIET one (the provider
 * request never resolves at all, which is the shape a blocked or dead CDN
 * actually takes in Russia) — the second is what the 12s watchdog exists for, and
 * a loud-only test would let a silently-hanging player ship.
 */
test.describe("014 EARS-5 the login gate and the mounted player (e2e)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  /** The real 003 login, mirroring `event-page-registered.spec.ts` L70-73. */
  async function signIn(page: import("@playwright/test").Page) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page
      .getByRole("textbox", { name: /почта|email/i })
      .fill(DOCTOR_EMAIL!);
    await page
      .getByRole("textbox", { name: /пароль|password/i })
      .fill(DOCTOR_PASSWORD!);
    await page.getByRole("button", { name: /войти|продолжить/i }).click();
    await page.waitForURL(/\/account|\/webinars/);
  }

  test("014 EARS-5: a guest gets the login gate in the player position — an account is named as the only thing in the way, and nothing about money", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto(`${BASE}/webinars/${ENDED_SLUG}`, {
      waitUntil: "domcontentloaded",
    });

    const gate = page.getByTestId("recording-gate");
    await expect(gate).toBeVisible();
    await expect(gate).toContainText("Войдите, чтобы посмотреть запись");
    await expect(gate).toContainText("бесплатна для врачей");
    // The gate is an invitation, not a paywall: the recording IS free, so any
    // price/subscription framing would be a lie about the product, not a
    // styling choice. Asserted on the gate's own text, not the whole page.
    await expect(gate).not.toContainText(/₽|подписк|оплат/i);

    // No player, and no source to play — the gate is not a soft wall over a
    // mounted frame (that is the whole reason the read split exists).
    await expect(page.getByTestId("recording-player")).toHaveCount(0);
    await expect(page.locator("iframe, video")).toHaveCount(0);
  });

  test("014 EARS-5: both gate actions carry this event page back through auth (EARS-6) — the doctor returns to the recording, not to a home page", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto(`${BASE}/webinars/${ENDED_SLUG}`, {
      waitUntil: "domcontentloaded",
    });

    const encoded = encodeURIComponent(`/webinars/${ENDED_SLUG}`);
    await expect(page.getByTestId("recording-gate-signin")).toHaveAttribute(
      "href",
      new RegExp(`^/login\\?returnTo=${encoded}$`),
    );
    await expect(page.getByTestId("recording-gate-signup")).toHaveAttribute(
      "href",
      new RegExp(`^/register\\?returnTo=${encoded}$`),
    );

    // The href is only half the promise — the click has to actually land on the
    // auth page carrying it, so the assertion follows the navigation.
    await page.getByTestId("recording-gate-signin").click();
    await page.waitForURL(new RegExp(`/login\\?returnTo=${encoded}$`));
  });

  test("014 EARS-5: a signed-in doctor gets the player itself — the gate is gone, one frame is mounted, and the recording meta rides with the card", async ({
    page,
  }) => {
    test.skip(!DOCTOR_EMAIL || !DOCTOR_PASSWORD, "requires a doctor account");
    await signIn(page);
    await page.goto(`${BASE}/webinars/${ENDED_SLUG}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByTestId("recording-gate")).toHaveCount(0);
    await expect(page.getByTestId("recording-player")).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(1);
    // The meta the #1697 dedup moved OUT of the status card has to be somewhere
    // — it belongs to the player card now, and «Монтаж» is this seed's kind.
    await expect(page.getByTestId("recording-meta")).toContainText("Монтаж");
  });

  test("014 EARS-5: a LOUD player failure swaps in the RU retry card, and retry actually remounts the frame", async ({
    page,
  }) => {
    test.skip(!DOCTOR_EMAIL || !DOCTOR_PASSWORD, "requires a doctor account");
    await signIn(page);
    await page.goto(`${BASE}/webinars/${ENDED_SLUG}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.locator("iframe")).toHaveCount(1);
    // Dispatched as a plain `Event` inside the page rather than through
    // Playwright's `dispatchEvent("error")` helper, which synthesizes its own
    // event object for the name. What a browser actually delivers to a dead
    // `<iframe>` is a bare `Event` of type `error` on the element, and that is
    // exactly what the component's native listener is bound for — so this is the
    // faithful input, not a convenience.
    await page
      .locator("iframe")
      .first()
      .evaluate((el) => el.dispatchEvent(new Event("error")));

    const card = page.getByTestId("recording-player-unavailable");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Запись временно недоступна");
    // The dead frame is REMOVED, not hidden behind the card: a frame still
    // loading underneath an error card is exactly the ambiguity the card exists
    // to resolve.
    await expect(page.locator("iframe")).toHaveCount(0);

    await page.getByTestId("recording-player-retry").click();
    await expect(page.locator("iframe")).toHaveCount(1);
    await expect(page.getByTestId("recording-player-unavailable")).toHaveCount(
      0,
    );
  });

  test("014 EARS-5: a QUIET player failure — the provider never answers at all — still resolves into the retry card, via the watchdog", async ({
    page,
  }) => {
    test.skip(!DOCTOR_EMAIL || !DOCTOR_PASSWORD, "requires a doctor account");
    await signIn(page);
    // Never fulfilled and never aborted: the request simply hangs, so the frame
    // fires neither `load` nor `error`. Nothing but the 12s watchdog can end
    // this state, which is the point of the test.
    await page.route(/rutube|youtube|vk\.com|cdnvideo/i, () => {});
    await page.goto(`${BASE}/webinars/${ENDED_SLUG}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByTestId("recording-player-unavailable")).toBeVisible({
      timeout: 20_000,
    });
  });

  test("014 EARS-5: a signed-in doctor on an event with nothing published still gets the plaque — a session buys access, not a recording that does not exist", async ({
    page,
  }) => {
    test.skip(!DOCTOR_EMAIL || !DOCTOR_PASSWORD, "requires a doctor account");
    test.skip(!PREPARING_SLUG, "requires an ended event with no recording");
    await signIn(page);
    await page.goto(`${BASE}/webinars/${PREPARING_SLUG}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByTestId("recording-plaque")).toBeVisible();
    await expect(page.getByTestId("recording-gate")).toHaveCount(0);
    await expect(page.getByTestId("recording-player")).toHaveCount(0);
  });
});
