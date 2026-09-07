import { expect, test, type Page } from "@playwright/test";

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
/** Its title, as the double serves it: what the door must name back to the guest. */
const TITLE = "PRP при гонартрозе: показания, протоколы, ошибки";

/**
 * The hand-off URL the api BUILDS for this host — the assertion target of
 * EARS-5, spelled here as the literal the resolver produces
 * (`/register?returnTo=` + the percent-escaped doctor event path) rather than
 * recomputed, so a change in either half fails this test.
 */
const HANDOFF = `/register?returnTo=${encodeURIComponent(`/events/${LIVE}`)}`;

const EMAIL = "doctor@clinic.ru";
const PASSWORD = "correct horse battery";

/**
 * Put a consent into the ticked state through its label — the hit area of the
 * checkbox primitive. Idempotent, because the fill below is retried: a second
 * click on an already-ticked box would UNtick it.
 */
async function setConsent(page: Page, testId: string) {
  const box = page.getByTestId(testId);
  if (!(await box.isChecked())) {
    await box.locator("xpath=ancestor::label[1]").click();
  }
  await expect(box).toBeChecked({ timeout: 2_000 });
}

/**
 * Walk 021 from the door the guest ALREADY stands on — no `goto`, because the
 * point of this tier is that the guest arrived here by pressing the CTA.
 */
async function completeRegistrationFromHere(page: Page) {
  // The door was reached by a real link press, so the browser did a full
  // document load and the form is server-rendered BEFORE React attaches. A
  // value typed into that pre-hydration DOM is discarded by the first client
  // render, and the submit stays disabled on a form that looks filled in. The
  // retry is that wait, expressed as the outcome it waits for: the form is
  // filled when the door itself agrees it is complete.
  await expect(async () => {
    await setConsent(page, "register-medworker");
    await setConsent(page, "register-partner-data");
    await page.getByTestId("register-email").fill(EMAIL);
    await page.getByTestId("register-password").fill(PASSWORD);
    await expect(page.getByTestId("register-submit")).toBeEnabled({
      timeout: 2_000,
    });
  }).toPass({ timeout: 15_000 });

  await page.getByTestId("register-submit").click();

  await expect(page.getByTestId("verify-submit")).toBeVisible();
  // The slotted OTP field auto-submits on completion (#175), so filling it IS
  // the submit; the code itself is never checked here.
  await page.locator("input[autocomplete=\"one-time-code\"]").fill("ABC123");
  await expect(page.getByTestId("registration-success")).toBeVisible();
}

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

    await cta.click();
    await expect(page).toHaveURL(HANDOFF);

    // The door names what the guest is coming back to — the hand-off is
    // legible, not a silent parameter.
    const panel = page.getByTestId("return-context-panel");
    await expect(panel).toBeVisible();
    await expect(panel.locator("[data-webinar-card]")).toContainText(TITLE);
  });

  test("020 EARS-5.2: completing 021 returns the doctor to exactly the event page they left, signed in", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto(`/events/${LIVE}`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("event-signup-cta").click();
    await expect(page).toHaveURL(HANDOFF);

    await completeRegistrationFromHere(page);

    // EXACTLY that URL: the primary action of the success state is the page the
    // journey started on, not the storefront home and not the cabinet.
    const primary = page.getByTestId("registration-success-primary");
    await expect(primary).toHaveAttribute("href", `/events/${LIVE}`);
    await primary.click();
    await expect(page).toHaveURL(new RegExp(`/events/${LIVE}$`));

    // 021 EARS-15 parity: the doctor lands SIGNED IN, so the page they came
    // back to no longer offers them the door they just walked through.
    const header = page.getByTestId("storefront-header");
    await expect(
      header.getByRole("link", { name: "Личный кабинет" }),
    ).toBeVisible();
    await expect(header.getByRole("link", { name: "Войти" })).toHaveCount(0);
  });

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
    await expect(page.locator("[data-testid^=\"register-\"]")).toHaveCount(0);
    await expect(page.locator("form")).toHaveCount(0);
  });
});
