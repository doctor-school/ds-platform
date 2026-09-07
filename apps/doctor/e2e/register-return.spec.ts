import { test, expect, type Page } from "@playwright/test";

/**
 * 021 EARS-10 (#1546) — where a confirmed doctor lands.
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
 *   2. the PRIMARY action of the success state is that target and its
 *      SECONDARY is the cabinet — never the other way round (EARS-10 is a
 *      requirement about RANK);
 *   3. a target that went stale degrades to a stated reason plus the nearest
 *      honest destination (LD-8), rather than to a silent redirect;
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
async function registerAndConfirm(page: Page, url: string) {
  await page.goto(url);
  await page.getByTestId("register-email").fill(EMAIL);
  await page.getByTestId("register-password").fill(PASSWORD);
  await tick(page, "register-medworker");
  await tick(page, "register-partner-data");
  await page.getByTestId("register-submit").click();

  await expect(page.getByTestId("verify-submit")).toBeVisible();
  // The slotted OTP field auto-submits on completion (#175), so filling it IS
  // the submit. The code itself is never checked here — the double delegates
  // that to the 003 engine exactly as the real command does.
  await page.locator("input[autocomplete=\"one-time-code\"]").fill("ABC123");
  await expect(page.getByTestId("registration-success")).toBeVisible();
}

test.describe("021 EARS-10: the post-confirmation landing", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("021 EARS-10.1: a live carried target is the primary action, and pressing it lands on the эфир", async ({
    page,
  }) => {
    await registerAndConfirm(page, arrival(LIVE));

    const primary = page.getByTestId("registration-success-primary");
    await expect(primary).toHaveAttribute("href", `/events/${LIVE}`);
    await expect(primary).toHaveText("Вернуться к эфиру →");
    // Nothing degraded, so nothing is explained away.
    await expect(page.getByTestId("registration-success-reason")).toHaveCount(0);

    await primary.click();
    await expect(page).toHaveURL(new RegExp(`/events/${LIVE}$`));
  });

  test("021 EARS-10.2: the cabinet is the secondary action and never the default", async ({
    page,
  }) => {
    await registerAndConfirm(page, arrival(LIVE));

    const primary = page.getByTestId("registration-success-primary");
    const secondary = page.getByTestId("registration-success-secondary");
    // The href, not a navigation: what `/account` does with a doctor who has
    // not yet signed in belongs to the contract of that route (#1958), and
    // asserting it here would make this tier fail for reasons of that route.
    await expect(secondary).toHaveAttribute("href", "/account");
    await expect(secondary).toHaveText("В личный кабинет");
    // RANK, as document order and as fill: the account page is never the
    // outcome this surface pushes.
    await expect(
      page.locator("a[data-testid^=\"registration-success-\"]"),
    ).toHaveText(["Вернуться к эфиру →", "В личный кабинет"]);
    await expect(primary).toHaveClass(/bg-primary-action/);
    await expect(secondary).not.toHaveClass(/bg-primary-action/);
  });

  test("021 EARS-10.3: a target that already ended says so, and lands on the эфир page anyway", async ({
    page,
  }) => {
    await registerAndConfirm(page, arrival(ENDED));

    const reason = page.getByTestId("registration-success-reason");
    // Contains, not equals: the Alert primitive prefixes an aria-hidden
    // glyph, which no assistive technology reads out.
    await expect(reason).toContainText(
      "Эфир, на который вы записывались, уже завершился — вот его страница.",
    );
    await expect(reason).toHaveAttribute("role", "status");

    const primary = page.getByTestId("registration-success-primary");
    await expect(primary).toHaveAttribute("href", `/events/${ENDED}`);
    // «Открыть», not «вернуться»: the doctor is not going back to what they
    // asked for, and the label must not pretend otherwise.
    await expect(primary).toHaveText("Открыть страницу эфира →");

    await primary.click();
    await expect(page).toHaveURL(new RegExp(`/events/${ENDED}$`));
  });

  test("021 EARS-10.4: a direct arrival lands where the DOOR decided, cabinet still secondary", async ({
    page,
  }) => {
    // No `returnTo` and no remembered specialty: the LD-4 storefront home. The
    // confirm API answers `/events` because it cannot read the 017 cookie —
    // the answer of the door is the one that reaches the doctor.
    await registerAndConfirm(page, "/register");

    const primary = page.getByTestId("registration-success-primary");
    await expect(primary).toHaveAttribute("href", "/");
    await expect(primary).toHaveText("На главную →");
    await expect(page.getByTestId("registration-success-reason")).toHaveCount(0);
    await expect(
      page.getByTestId("registration-success-secondary"),
    ).toHaveAttribute("href", "/account");

    await primary.click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("021 EARS-9: the accrual is named as a pending promise, with no amount and no ledger link", async ({
    page,
  }) => {
    await registerAndConfirm(page, arrival(LIVE));

    const accrual = page.getByTestId("registration-success-accrual");
    await expect(accrual).toHaveText(
      "Стартовые очки за регистрацию начислим на ваш счёт",
    );
    // LD-6 — no configuration-derived number anywhere on the surface, and no
    // link to a ledger that feature 025 has not built.
    await expect(accrual.locator("a")).toHaveCount(0);
    // EARS-9 — nothing configured to name, so the row is absent, not empty.
    await expect(
      page.getByTestId("registration-success-profile"),
    ).toHaveCount(0);
  });
});
