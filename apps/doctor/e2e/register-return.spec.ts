import { test, expect, type Page } from "@playwright/test";

/**
 * 021 EARS-10 (#1546, amended 2026-09-17) — where a confirmed doctor lands.
 *
 * The browser tier of the clause, and the only tier that can prove what it
 * claims. Four things have to hold together, and none of them is observable
 * from a unit test of either half:
 *
 *   1. the target the doctor carried into the door SURVIVES the confirmation
 *      hop — the register route projects the canonical academy
 *      `?returnTo=/webinars/<slug>` into the doctor-host `/events/<slug>`
 *      (#1945), the confirm command carries THAT value, and the server
 *      re-validates it;
 *   2. the accepted code lands the doctor ON that target — no interstitial, no
 *      second tap, the same rule the Academy `/verify` runs;
 *   3. a target that went stale lands on the nearest honest destination the
 *      server picked (LD-8) rather than on a dead эфир;
 *   4. a direct arrival lands on the LD-4 landing the DOOR decided, which the
 *      confirm API cannot know — so the promise made on the door is the
 *      promise that is kept.
 *
 * The tier boots the app against `e2e/support/return-context-api.mjs`
 * (`playwright.return-context.config.ts`) because the projection happens on the
 * SERVER, before the first byte of HTML, and because the confirm answer is a
 * decision of the upstream — a browser-level route interception would let the
 * tier assert its own fixture instead of the journey.
 */

/** The live эфир the double answers for — a return that is still honourable. */
const LIVE = "prp-pri-gonartroze";
/** The эфир that already ended — the LD-8 degraded branch. */
const ENDED = "ended-vedenie-hronicheskoy-boli";

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
 * ACADEMY shape under `returnTo`. The doctor-host projection of it is what has
 * to reach the confirm command, and that projection is exactly what this tier
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
    await registerAndConfirmLandingOn(
      page,
      arrival(LIVE),
      new RegExp(`/events/${LIVE}$`),
    );

    // The owner's objection, as an assertion: no acknowledgement screen stands
    // between the code and the эфир, and nothing on the way asks for a tap.
    await expect(page.getByTestId("registration-success")).toHaveCount(0);
    await expect(page.getByText("Почта подтверждена")).toHaveCount(0);
  });

  test("021 EARS-10.3: a target that already ended lands on the эфир page anyway", async ({
    page,
  }) => {
    // LD-8 — the server knew WHY the target could not be honoured and named the
    // nearest honest destination; the doctor is taken there. The эфир page
    // itself is what states that it has ended, so no second surface repeats it.
    await registerAndConfirmLandingOn(
      page,
      arrival(ENDED),
      new RegExp(`/events/${ENDED}$`),
    );
  });

  test("021 EARS-10.4: a direct arrival lands where the DOOR decided", async ({
    page,
  }) => {
    // No `returnTo` and no remembered specialty: the LD-4 storefront home. The
    // confirm API answers `/events` because it cannot read the 017 cookie —
    // the answer of the door is the one that reaches the doctor.
    await registerAndConfirmLandingOn(page, "/register", /\/$/);
  });

  test("021 EARS-15: the confirmed doctor lands on the эфир SIGNED IN, and is never asked to register again", async ({
    page,
  }) => {
    // The defect this test exists to catch (#1996, owner Stage-B withdrawal):
    // `/v1/storefront/doctor/confirm` verifies the email and mints NO session,
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
    // Still the confirmation step, on the door route, with its co-equal
    // sign-in action carrying the return context (rule S3).
    await expect(page).toHaveURL(/\/register\?/);
    await expect(page.getByTestId("verify-submit")).toBeVisible();
    await expect(page.getByTestId("verify-go-to-login")).toBeVisible();
  });
});
