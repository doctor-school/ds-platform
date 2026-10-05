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
 *   2. the accepted code (the storefront's `/v1/storefront/doctor/verify`, the
 *      one 003 engine as on the Academy; its answer is the session, 003
 *      EARS-41) lands the doctor ON that target, signed in — no interstitial,
 *      no second tap;
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
/** A code the double accepts — any code but {@link REFUSED_CODE}. */
const CODE = "ABC123";
/**
 * The code `e2e/support/return-context-api.mjs` answers with the generic 400
 * of a wrong, expired or used code (003 EARS-16/41). Byte-identical to
 * `REFUSED_CODE` in that module; it is sent from here and only from here.
 */
const REFUSED_CODE = "NOPE42";

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
  code: string = CODE,
) {
  await page.goto(url);
  await page.getByTestId("register-email").fill(EMAIL);
  await page.getByTestId("register-password").fill(PASSWORD);
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
  // the submit. The code's verdict is the double's one constant, never a
  // switch in this tier.
  await page.locator("input[autocomplete=\"one-time-code\"]").fill(code);
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
    // 003 EARS-41/23 (#2556) — the doctor storefront's code command: the
    // address, the code and the in-tab registration values, no target and no
    // named destination.
    const verify = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/v1/storefront/doctor/verify",
    );
    await registerAndConfirmLandingOn(
      page,
      arrival(LIVE),
      new RegExp(`/events/${LIVE}$`),
    );
    expect((await verify).postDataJSON()).toEqual({
      email: EMAIL,
      code: CODE,
      registration: expect.objectContaining({
        password: PASSWORD,
        medicalWorkerDeclaration: true,
      }),
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
    // a doctor who typed the code arriving on the эфир as a guest, with
    // «Участвовать» sending them back to the door they had just walked
    // through. Since 003 EARS-41 (#2556) the accepted code IS the sign-in —
    // the code command's answer sets the session, no replay follows — and the
    // ONLY place that is observable is here: the session is a cookie set by
    // the upstream, read on the SERVER by `@ds/auth-flow/server` when the
    // landing page renders.
    const replays: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/v1/auth/login") {
        replays.push(request.url());
      }
    });
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
    // The session came with the code: no sign-in replay left the browser.
    expect(replays).toEqual([]);
  });

  test("003 EARS-41/42: a refused code keeps the doctor on the code step with the generic error, no routing", async ({
    page,
  }) => {
    // A wrong, expired or used code gets the one generic 003 EARS-16 answer:
    // no session, so the doctor is neither walked onto the эфир as a guest
    // (the #1996 loop) nor routed anywhere — they stay on the step with the
    // generic sentence, the one post-throw exit both hosts share.
    await registerAndConfirm(page, arrival(LIVE), REFUSED_CODE);

    await expect(page.getByText("Код не подошёл. Попробуйте ещё раз.")).toBeVisible();
    // Still the code step, on the `/verify` route, with «← Изменить почту»
    // back to the form (003 EARS-24).
    await expect(page).toHaveURL(/\/verify\?/);
    await expect(page.getByTestId("verify-submit")).toBeVisible();
    await expect(page.getByTestId("verify-back")).toBeVisible();
  });
});
