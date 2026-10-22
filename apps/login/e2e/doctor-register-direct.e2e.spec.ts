import { test, expect } from "@playwright/test";

import { doorPath } from "./support/sign-in-door";

/**
 * 021 EARS-3 (#1539) — THE DIRECT ARRIVAL.
 *
 * The doctor who typed the address, followed the shell's «Регистрация» link or
 * came from a search result carries no return target. Two things then have to
 * hold, and neither is observable without a browser:
 *
 *   1. NOTHING stands in for the context they do not have. Not an empty frame,
 *      not a placeholder card, not a disabled slot — the return-context nodes
 *      are ABSENT from the tree, the brand panel shows its value prop instead,
 *      and the form is fully usable. This is the honest-empty rule of the
 *      requirements invariant, asserted here as counts of zero so no future
 *      slice can reintroduce a frame and still pass;
 *   2. the LD-4 LANDING is decided on the SERVER and published on the form
 *      (`data-registration-landing`) — the 019 events feed for a doctor whose
 *      specialty 017 already remembers, the storefront home otherwise, and
 *      NEVER the account page (the owner's decision on LD-4).
 *
 * WHY THIS TIER AND NOT A UNIT TEST. `packages/auth-flow/src/server/landing.test.ts`
 * pins the decision; it cannot pin that the route reaches it. The remembered specialty is
 * read server-side from the forwarded `__Host-ds_specialty` cookie before the
 * first byte of HTML, so the read is out of reach of any browser-level route
 * interception — the same reason the EARS-2 half of this tier exists. The app is
 * booted against `e2e/support/return-context-api.mjs`, which answers the
 * specialty read from that cookie exactly as the real api does.
 *
 * The confirmation hop itself is NOT driven here and cannot be: the submit on
 * this screen is inert by design pending EARS-5 (#1541) and EARS-19 (#1558), and
 * the post-confirmation success state that consumes this landing is EARS-10
 * (#1546). What this tier proves is that the decision is real, correct and
 * published — the seam #1546 reads, not a decoration.
 */

/** The two LD-4 destinations, spelled out here rather than imported: the tier is
 *  the outside view, and a test that imported the constant it asserts could not
 *  catch the constant itself changing. */
const HOME = "/";

test.describe("021 EARS-3: the direct arrival carries no context", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("021 EARS-3.1: a bare /register renders no return-context node anywhere, and the brand panel shows its value prop", async ({
    page,
  }) => {
    await page.goto(doorPath("doctor", "register"));

    // Absent, not empty — every node the resolved branch would have produced,
    // asserted as a count of zero rather than «not visible».
    await expect(page.getByTestId("return-context-panel")).toHaveCount(0);
    await expect(page.getByTestId("return-context-plate")).toHaveCount(0);
    await expect(page.getByTestId("registration-return-context")).toHaveCount(
      0,
    );
    await expect(page.locator("[data-webinar-card]")).toHaveCount(0);

    // The split's left half is the brand panel's own pitch, which is what the
    // zone holds when no context takes its place.
    const panel = page.getByTestId("auth-brand-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Медицинское образование для врачей");
  });

  test("021 EARS-3.2: the form is fully usable on a direct arrival, and the live submit reports what is still ungranted", async ({
    page,
  }) => {
    await page.goto(doorPath("doctor", "register"));

    await page.getByTestId("register-email").fill("doctor@ds.test");
    await expect(page.getByTestId("register-email")).toHaveValue(
      "doctor@ds.test",
    );
    await page.getByTestId("register-password").fill("Aa1!ufficiently-long-pw");
    await expect(page.getByTestId("register-password")).toHaveValue(
      "Aa1!ufficiently-long-pw",
    );
    await page.getByTestId("register-promo").fill("PROMO-2026");
    await expect(page.getByTestId("register-promo")).toHaveValue("PROMO-2026");
    // The DS `Checkbox` input is `sr-only` behind its painted box, so a user
    // clicks the wrapping label — the same gesture `register-medworker.spec.ts`
    // makes, not a `force` that no mouse could perform.
    await page
      .getByTestId("register-medworker")
      .locator("xpath=ancestor::label[1]")
      .click();
    await expect(page.getByTestId("register-medworker")).toBeChecked();

    // Live BY DESIGN (canvas 490): pressing with the second access condition
    // still ungranted tells the doctor so ON THAT ROW rather than leaving a
    // dead button — and no reason line stands beside the submit at all.
    await expect(page.getByTestId("register-submit")).toBeEnabled();
    await page.getByTestId("register-submit").click();
    await expect(page.getByTestId("register-partner-data")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(
      page.getByTestId("register-partner-data-item"),
    ).not.toBeEmpty();
    await expect(page.getByTestId("register-submit")).toBeEnabled();
  });
});

test.describe("021 EARS-3: LD-4 — where the direct arrival lands", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  // #3172 — the remembered-specialty branch (EARS-3.4 «the events feed»,
  // EARS-3.5 «never the account page») is the STOREFRONT callback's landing:
  // the specialty cookie is the storefront's and never reaches this host, so
  // those landings are proven by the stand journeys (`packages/e2e`).
  test("021 EARS-3.3: with nothing remembered the landing is the storefront home", async ({
    page,
  }) => {
    await page.goto(doorPath("doctor", "register"));

    await expect(page.getByTestId("registration-form")).toHaveAttribute(
      "data-registration-landing",
      HOME,
    );
  });

  test("021 EARS-3.7: a gate arrival publishes its own return target on the same attribute — one attribute, one vocabulary", async ({
    page,
  }) => {
    // The canonical arrival URL the gate emits (005 EARS-2), resolved by the
    // shared guard; the landing is derived from the guard's reconstruction,
    // never from the raw param, and the LD-4 resolver is not consulted at all.
    // #3172 — the storefront entry records the gate target as the EARS-71
    // intent (doctor tier); the sign-in host renders the door from it.
    await page.goto(
      doorPath("doctor", "register", { eventTarget: "prp-pri-gonartroze" }),
    );

    // #1945 corrected WHICH path that derivation yields. One attribute and one
    // vocabulary still hold — the guard is the only parser on this route — but
    // the attribute carries the landing on THIS host, and `/webinars/<slug>` is
    // an academy route that doctor.school does not serve (020-design §1). The
    // storefront's own page for the same эфир is `/events/<slug>`, so publishing
    // the canonical target verbatim here landed a confirmed doctor on a 404.
    await expect(page.getByTestId("registration-form")).toHaveAttribute(
      "data-registration-landing",
      "/events/prp-pri-gonartroze",
    );
    await expect(page.getByTestId("return-context-panel")).toBeVisible();
  });
});
