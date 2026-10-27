import { expect, test } from "@playwright/test";

/**
 * 020 EARS-5 (#1768) — the guest hand-off from the doctor event page into
 * feature 021, and the exact return.
 *
 * The clause is a JOURNEY across two features and three server decisions, and
 * no single unit can observe it:
 *
 *   1. the event page's ONE «Участвовать» control is the api's CTA
 *      (`participation-cta.resolver.ts` against this host's `DOCTOR_ROUTES`) —
 *      the page computes no href of its own;
 *   2. pressing it lands on THIS host's `/register` carrying THIS page as the
 *      target, and the door names the event it will come back to;
 *   3. completing 021 returns the doctor to exactly `/events/<slug>` — the
 *      same URL they left, not the storefront home and not the cabinet.
 *
 * It runs on the `playwright.return-context.config.ts` tier, over
 * `e2e/support/return-context-api.mjs`, because every one of those three is a
 * SERVER read taken before the first byte of HTML: the event envelope, the
 * participation CTA and the return context are all resolved upstream, so a
 * browser-intercepted tier could only assert its own fixture of the hand-off
 * instead of the hand-off.
 *
 * Scope boundary — the two other arms of EARS-5 are NOT proven here and are
 * not implemented here: the participation intent RESUMED on return
 * (auto-registration after the round-trip) belongs to #2005, and the `mode=`
 * tab arm to #1771 (R1.1). R1 acceptance is the hand-off and the exact return.
 */

/** The эфир the double answers for — the same fixture `register-return.spec.ts` walks. */
const LIVE = "prp-pri-gonartroze";

/**
 * The hand-off URL the api BUILDS for this host — the assertion target of
 * EARS-5, spelled here as the literal the resolver produces
 * (`/register?returnTo=` + the percent-escaped doctor event path) rather than
 * recomputed, so a change in either half fails this test.
 */
/** The shared internal-API double's transaction log (`playwright.return-context.config.ts`). */
const TRANSACTIONS = `http://127.0.0.1:${process.env.STOREFRONT_DOUBLE_PORT ?? 3217}/__transactions`;

const HANDOFF = `/register?returnTo=${encodeURIComponent(`/events/${LIVE}`)}`;

test.describe("020 EARS-5: the guest hand-off into 021 and the exact return", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("020 EARS-5.1: a guest pressing «Участвовать» enters 021 on THIS host carrying this page as the return target", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto(`/events/${LIVE}`, { waitUntil: "domcontentloaded" });

    // ONE participation control, and its href is the api's — the doctor host's
    // own `/register`, never the academy's, carrying the doctor host's own
    // event path percent-escaped.
    const cta = page.getByTestId("event-signup-cta");
    await expect(cta).toHaveCount(1);
    // Contains, not equals: the button primitive appends a decorative ↗ glyph
    // that no assistive technology reads out.
    await expect(cta).toContainText("Участвовать");
    await expect(cta).toHaveAttribute("href", HANDOFF);

    // #3172 — `/register` is the storefront's 303 entry into the sign-in
    // host: it records this page as the EARS-71 event target, the return
    // path and the registration the callback completes (005 EARS-2). The
    // card the guest then meets on the host is proven on the sign-in host
    // tier (`doctor-register-return-context.e2e.spec.ts` 021 EARS-2.1).
    const entry = page.waitForResponse(
      (res) =>
        res.request().isNavigationRequest() &&
        new URL(res.url()).pathname === "/register",
    );
    await cta.click();
    const answer = await entry;
    expect(answer.status()).toBe(303);
    expect(new URL(answer.url()).search).toBe(
      `?returnTo=${encodeURIComponent(`/events/${LIVE}`)}`,
    );
    await expect(page).toHaveURL(/\/oauth\/v2\/authorize\?.*state=tx-\d+/);
    const state = new URL(page.url()).searchParams.get("state")!;
    const sent = (await (
      await page.request.get(TRANSACTIONS)
    ).json()) as Record<string, unknown>[];
    expect(sent[Number(state.slice(3)) - 1]).toMatchObject({
      client: "doctor",
      door: "register",
      returnPath: `/events/${LIVE}`,
      intent: { eventTarget: LIVE },
      completeRegistration: LIVE,
    });
  });

  // #3172 — 020 EARS-5.2 («completing 021 returns the doctor to exactly the
  // event page they left, signed in») is the storefront callback's landing
  // now (003 EARS-62, 005 EARS-2): proven by the stand journeys
  // (`packages/e2e`); the registration journey up to the host's success
  // answer rides `apps/login/e2e/doctor-register-return.e2e.spec.ts`.

  test("020 EARS-5.3: the event page hands 021 off and hosts none of it — no form, no consent, no attribution", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto(`/events/${LIVE}`, { waitUntil: "domcontentloaded" });

    // 020 owns the CTA and nothing else of registration: every 021 control is
    // ABSENT from this page, not hidden on it.
    await expect(page.getByTestId("register-email")).toHaveCount(0);
    await expect(page.getByTestId("register-password")).toHaveCount(0);
    await expect(page.getByTestId("register-submit")).toHaveCount(0);
    await expect(page.getByTestId("register-medworker")).toHaveCount(0);
    await expect(page.getByTestId("register-partner-data")).toHaveCount(0);
    await expect(page.locator('[data-testid^="register-"]')).toHaveCount(0);
    // Scoped to the PAGE, not the document: since #2180 the shared chrome owns a
    // `<form role="search">` in the header on every doctor route (017 EARS-5), so
    // a document-wide `form` count would assert the absence of the header rather
    // than the absence of registration. The clause is about what the EVENT PAGE
    // hosts — `<main>` is exactly that boundary.
    await expect(page.locator("main form")).toHaveCount(0);
  });
});
