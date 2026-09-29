import { test, expect, type Page } from "@playwright/test";

/**
 * 021 EARS-10 (#1546, amended 2026-09-17 and 2026-09-29) — where a confirmed
 * doctor lands.
 *
 * The browser tier of the clause, and the only tier that can prove what it
 * claims. Four things have to hold together, and none of them is observable
 * from a unit test of either half:
 *
 *   1. the target the doctor carried into the door SURVIVES the hop onto this
 *      host's own `/verify` route (003 EARS-24, #2455) — the canonical academy
 *      `?returnTo=/webinars/<slug>` rides its query and the route projects it
 *      into the doctor-host `/events/<slug>` (#1945) on the SERVER;
 *   2. the accepted code (the one 003 `/v1/auth/verify` command, as on the
 *      Academy) lands the doctor ON that target — no interstitial, no second
 *      tap;
 *   3. owner decision Б (2026-09-29): an эфир that ended still lands on its own
 *      page, which states that itself, and one that no longer exists lands on
 *      the LD-4 default;
 *   4. a direct arrival lands on the LD-4 landing the route decided.
 *
 * The tier boots the app against `e2e/support/return-context-api.mjs`
 * (`playwright.return-context.config.ts`) because the projection happens on the
 * SERVER, before the first byte of HTML, against the upstream's public event
 * read — a browser-level route interception would let the tier assert its own
 * fixture instead of the journey.
 */

/** The live эфир the double answers for — a return that is still honourable. */
const LIVE = "prp-pri-gonartroze";
/** The эфир that already ended — its page still exists (owner decision Б). */
const ENDED = "ended-vedenie-hronicheskoy-boli";
/** An эфир the upstream's public read does not know — it no longer exists. */
const GONE = "udalennyy-efir";

const EMAIL = "doctor@clinic.ru";
const PASSWORD = "correct horse battery";
/**
 * The credential `e2e/support/return-context-api.mjs` answers with the generic
 * 401 — the journey of a doctor who re-registered the same email with a SECOND
 * password while the IdP kept the first (003 EARS-16 answers a repeat
 * registration identically, so nothing on the way tells them). Byte-identical to
 * `REFUSED_PASSWORD` in that module; it is sent from here and only from here.
 */
const REFUSED_PASSWORD = "the second password the idp never took";

/**
 * The canonical gate hand-off URL, built the way the producer builds it
 * (`apps/api/src/events/participation-cta.resolver.ts` → `cta.href`): the
 * ACADEMY shape under `returnTo`. The doctor-host projection of it is where the
 * confirmed doctor has to land, and that projection is exactly what this tier
 * is here to observe.
 */
function arrival(slug: string): string {
  return `/register?${new URLSearchParams({ returnTo: `/webinars/${slug}` })}`;
}

/** Tick a consent through its label — the hit area of the checkbox primitive. */
async function tick(page: Page, testId: string) {
  await page.getByTestId(testId).locator("xpath=ancestor::label[1]").click();
  await expect(page.getByTestId(testId)).toBeChecked();
}

/** Walk the whole journey: fill the door, submit, type the code, confirm. */
async function registerAndConfirm(
  page: Page,
  url: string,
  password: string = PASSWORD,
) {
  await page.goto(url);
  await page.getByTestId("register-email").fill(EMAIL);
  await page.getByTestId("register-password").fill(password);
  await tick(page, "register-medworker");
  await tick(page, "register-partner-data");
  await page.getByTestId("register-submit").click();

  // 003 EARS-24 (#2455) — the confirmation is this host's own `/verify` step,
  // the address and the carried target in its query, as on the Academy.
  await expect(page).toHaveURL(/\/verify\?/);
  const step = new URL(page.url());
  expect(step.searchParams.get("email")).toBe(EMAIL);
  await expect(page.getByTestId("verify-submit")).toBeVisible();
  // The slotted OTP field auto-submits on completion (#175), so filling it IS
  // the submit. The code itself is never checked here — the double delegates
  // that to the 003 engine exactly as the real command does.
  await page.locator("input[autocomplete=\"one-time-code\"]").fill("ABC123");
}

/**
 * The journey above, through to the page a signed-in doctor is landed on.
 *
 * The wait IS the assertion of the amended clause: there is no outcome card to
 * wait for any more, so the first thing that can be observed after the code is
 * the destination itself.
 */
async function registerAndConfirmLandingOn(
  page: Page,
  url: string,
  landing: RegExp,
) {
  await registerAndConfirm(page, url);
  await expect(page).toHaveURL(landing);
}

test.describe("021 EARS-10: the post-confirmation landing", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("021 EARS-10.1: a live carried target IS the landing — the accepted code opens the эфир itself", async ({
    page,
  }) => {
    // 003 EARS-3 (#2455) — the one confirm command both storefronts post: the
    // address and the code, no target and no named destination.
    const verify = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/v1/auth/verify",
    );
    await registerAndConfirmLandingOn(
      page,
      arrival(LIVE),
      new RegExp(`/events/${LIVE}$`),
    );
    expect((await verify).postDataJSON()).toEqual({
      email: EMAIL,
      code: "ABC123",
    });

    // The owner's objection, as an assertion: no acknowledgement screen stands
    // between the code and the эфир, and nothing on the way asks for a tap.
    await expect(page.getByTestId("registration-success")).toHaveCount(0);
    await expect(page.getByText("Почта подтверждена")).toHaveCount(0);
  });

  test("021 EARS-10.3: a target that already ended lands on the эфир page anyway", async ({
    page,
  }) => {
    // Owner decision Б (2026-09-29) — the эфир page still exists, so it is the
    // landing; the page itself states that the эфир has ended.
    await registerAndConfirmLandingOn(
      page,
      arrival(ENDED),
      new RegExp(`/events/${ENDED}$`),
    );
  });

  test("021 EARS-10.5: a target whose эфир no longer exists lands on the default landing", async ({
    page,
  }) => {
    // Owner decision Б (2026-09-29) — nothing answers for the эфир, so there is
    // no page to land on: the LD-4 storefront home (no remembered specialty).
    await registerAndConfirmLandingOn(page, arrival(GONE), /\/$/);
  });

  test("021 EARS-10.4: a direct arrival lands where the DOOR decided", async ({
    page,
  }) => {
    // No `returnTo` and no remembered specialty: the LD-4 storefront home.
    await registerAndConfirmLandingOn(page, "/register", /\/$/);
  });

  test("021 EARS-15: the confirmed doctor lands on the эфир SIGNED IN, and is never asked to register again", async ({
    page,
  }) => {
    // The defect this test exists to catch (#1996, owner Stage-B withdrawal):
    // the confirm command verifies the email and mints NO session,
    // so a doctor who typed the code still arrived on the эфир as a guest and
    // «Участвовать» sent them back to the door they had just walked through.
    // The fix is the Academy's own mechanism — the held password replayed
    // through the real 003 EARS-5 login — and the ONLY place it is observable
    // is here: the session is a cookie set by the upstream, read on the SERVER
    // by `@ds/auth-flow/server` when the landing page renders.
    await registerAndConfirmLandingOn(
      page,
      arrival(LIVE),
      new RegExp(`/events/${LIVE}$`),
    );

    // The header of the landed page is the observable outcome: the signed-in
    // cluster, not «Войти».
    const header = page.getByTestId("storefront-header");
    await expect(
      header.getByRole("link", { name: "Личный кабинет" }),
    ).toBeVisible();
    await expect(header.getByRole("link", { name: "Войти" })).toHaveCount(0);
  });

  test("021 EARS-15.3: a replay the login refuses keeps the doctor on the confirmation step with the generic error, no routing", async ({
    page,
  }) => {
    // Owner decision 2026-09-15 (tech spec §5 Q1, «Как в Академии»), driven end
    // to end: the credential in the slot is not the one the IdP holds, so the
    // replay is refused. The email IS verified but there is no session, so the
    // doctor is neither walked onto the эфир as a guest (the #1996 loop) nor
    // routed anywhere: they stay on the step with the generic 003 EARS-16
    // sentence, the one post-throw exit both hosts share.
    await registerAndConfirm(page, arrival(LIVE), REFUSED_PASSWORD);

    await expect(page.getByText("Код не подошёл. Попробуйте ещё раз.")).toBeVisible();
    // Still the confirmation step, on the `/verify` route, with its co-equal
    // sign-in action carrying the return context (rule S3).
    await expect(page).toHaveURL(/\/verify\?/);
    await expect(page.getByTestId("verify-submit")).toBeVisible();
    await expect(page.getByTestId("verify-go-to-login")).toBeVisible();
  });
});
