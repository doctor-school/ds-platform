import { test, expect, type Page } from "@playwright/test";

/**
 * 021 EARS-1 — the doctor registration route as a CHROMELESS auth frame.
 *
 * The browser tier of the EARS-1 contract, and the only tier that can prove what
 * the clause actually asserts: that the route renders the `auth` canvas's
 * chromeless split — no storefront header, navigation or footer, the wordmark
 * present, the card centred on the vertical axis — that the door asks for
 * exactly three things, and that no document is ever requested at it (REQ-22 —
 * the feature's central product promise).
 *
 * On REQ-22 and the word «документ». The requirement (021-requirements-en §112)
 * bans the *request*: "no upload control, no file input, no document field and no
 * «прикрепите диплом» copy". It does not ban the promise — the canvas card head
 * says «Документы на входе не нужны.», which is REQ-22 being *stated to the
 * doctor*, and 021-product.md builds the whole positioning on it. So 1.3 scans
 * for request-shaped tells and asserts the promise is present, instead of
 * banning a substring. The scan stays scoped to the registration screen because
 * that is the surface the requirement governs — the scope is the contract, not a
 * workaround for neighbouring copy.
 *
 * Scope of this slice: layout only. The envelope's other slots (return context,
 * attribution, points promise, consent tiers — return context #1538, attribution
 * #1544, points promise #1545, consent tiers #1540/#1541/#1542) are
 * unfilled here, and EARS-3's honest-empty rule makes an unfilled slot ABSENT
 * from the tree rather than an empty frame — which 1.5 pins, so a later Issue
 * cannot land a reserved placeholder frame without failing this spec first.
 *
 * Backend-free tier (`playwright.ci.config.ts`): the submit is inert in this
 * slice (design §2 — no public 021 form may reach a 003 EARS-17-protected
 * endpoint without the EARS-19 bot-protection client half, which `apps/doctor`
 * does not have), so 1.6 pins the EARS-12 disabled-with-stated-reason rendering
 * that keeps a silently dead button out of every state.
 */

/** Copy or controls that would constitute *asking* for a document (REQ-22). */
const DOCUMENT_REQUEST_TELLS = [
  "диплом",
  "снилс",
  "скан",
  "загрузите",
  "загрузить файл",
  "прикрепите",
  "прикрепить",
  "приложите",
  "выберите файл",
  "перетащите",
  "удостоверение",
  "подтвердите квалификацию",
];

/** The REQ-22 promise as the canvas states it in the card head. */
const NO_DOCUMENTS_PROMISE = "Документы на входе не нужны.";

async function assertNoDocumentRequest(page: Page, state: string) {
  // No upload affordance anywhere on the document, in any state.
  await expect(
    page.locator(
      'input[type="file"], [accept], [role="button"][aria-label*="файл" i]',
    ),
    `upload affordance on the registration surface (${state})`,
  ).toHaveCount(0);

  const text = (
    await page.getByTestId("registration-screen").innerText()
  ).toLowerCase();
  for (const tell of DOCUMENT_REQUEST_TELLS) {
    expect(
      text,
      `document-request copy «${tell}» on the register screen (${state})`,
    ).not.toContain(tell);
  }
}

test.describe("021 EARS-1: the chromeless registration route", () => {
  test("021 EARS-1.1: the chromeless auth frame renders — wordmark, brand panel, card", async ({
    page,
  }) => {
    await page.goto("/register");

    await expect(page.getByTestId("registration-screen")).toBeVisible();
    // The storefront shell does not exist on this route at all: the route lives
    // in the `(auth)` group, a SIBLING of `(storefront)`, so the 017 layout is
    // never in the tree — not merely hidden by CSS.
    await expect(page.getByTestId("storefront-shell")).toHaveCount(0);

    // The frame the canvas draws instead: the wordmark plus the two halves of
    // the split — the brand panel and the bordered form card. Exactly ONE
    // wordmark is visible per viewport: above the split it is the panel mark,
    // and the form-column lockup is hidden (1.7 pins the mirror case at 390).
    await expect(page.getByTestId("auth-panel-wordmark")).toBeVisible();
    await expect(page.getByTestId("auth-wordmark")).toBeHidden();
    await expect(page.getByTestId("auth-brand-panel")).toBeVisible();
    await expect(page.getByTestId("registration-form-card")).toBeVisible();
    // The route owns the document's single h1 (no layout above it carries one).
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveText("Регистрация");
  });

  test("021 EARS-1.2: exactly three inputs — email, password, optional promo", async ({
    page,
  }) => {
    await page.goto("/register");

    const form = page.getByTestId("registration-form");
    await expect(form.locator("input")).toHaveCount(3);

    const email = page.getByTestId("register-email");
    await expect(email).toHaveAttribute("type", "email");
    await expect(email).toHaveAttribute("autocomplete", "email");

    const password = page.getByTestId("register-password");
    await expect(password).toHaveAttribute("type", "password");
    await expect(password).toHaveAttribute("autocomplete", "new-password");

    // Optional: the promo code is never a condition of opening the door.
    const promo = page.getByTestId("register-promo");
    await expect(promo).toHaveAttribute("type", "text");
    expect(await promo.getAttribute("required"), "promo required").toBeNull();
    expect(
      await promo.getAttribute("aria-required"),
      "promo aria-required",
    ).not.toBe("true");

    // Design §7's «trim + length bound» must not rewrite what is being typed:
    // trimming on every keystroke makes an interior space unreachable, because
    // the trailing space is stripped before the next character arrives. Typed
    // interior whitespace survives; the surrounding whitespace goes on blur.
    await promo.fill("");
    await promo.pressSequentially("  DS 2026  ");
    await expect(promo, "promo value while typing").toHaveValue("  DS 2026  ");
    await promo.blur();
    await expect(promo, "promo value after blur").toHaveValue("DS 2026");
  });

  test("021 EARS-1.3: no document is requested in the empty, filled or error state", async ({
    page,
  }) => {
    await page.goto("/register");
    await assertNoDocumentRequest(page, "empty");
    // REQ-22 is not merely absent — the card head states it to the doctor.
    await expect(page.getByTestId("registration-form-card")).toContainText(
      NO_DOCUMENTS_PROMISE,
    );

    await page.getByTestId("register-email").fill("doctor@clinic.ru");
    await page.getByTestId("register-password").fill("verysecret1");
    await page.getByTestId("register-promo").fill("DS-2026");
    await assertNoDocumentRequest(page, "filled");

    // Drive the client-validation error state: a malformed address and an empty
    // password, both blurred (the form validates `onTouched`).
    await page.getByTestId("register-password").fill("");
    await page.getByTestId("register-password").blur();
    await page.getByTestId("register-email").fill("not-an-address");
    await page.getByTestId("register-email").blur();
    await expect(page.locator('[aria-invalid="true"]').first()).toBeVisible();
    await assertNoDocumentRequest(page, "error");
  });

  test("021 EARS-1.4: no site chrome anywhere on the route", async ({
    page,
  }) => {
    await page.goto("/register");

    // Not «the route adds none of its own» — the door carries NO header, nav or
    // footer at all, from any layer. A single onward-link cluster on this screen
    // is the defect: it leads the doctor away from the one CTA they came for.
    await expect(page.locator("header")).toHaveCount(0);
    await expect(page.locator("footer")).toHaveCount(0);
    await expect(page.locator("nav")).toHaveCount(0);
    await expect(page.getByTestId("storefront-header")).toHaveCount(0);
    await expect(page.getByTestId("storefront-footer")).toHaveCount(0);
  });

  test("021 EARS-1.5: an unfilled envelope slot is absent from the tree, not an empty frame", async ({
    page,
  }) => {
    await page.goto("/register");

    // EARS-3 honest-empty: these belong to later Issues and nothing supplies
    // them here, so they must not ship as reserved shells.
    for (const slot of [
      "registration-return-context",
      "registration-attribution",
      "registration-points-promise",
      "registration-consent-access",
      "registration-consent-marketing",
    ]) {
      await expect(page.getByTestId(slot), `unfilled slot ${slot}`).toHaveCount(
        0,
      );
    }
  });

  test("021 EARS-1.6: the inert submit is disabled with a stated, wired reason", async ({
    page,
  }) => {
    await page.goto("/register");

    const submit = page.getByTestId("register-submit");
    await expect(submit).toBeDisabled();

    // EARS-12: a silently dead button exists in no state of this surface.
    const reason = page.getByTestId("register-submit-reason");
    await expect(reason).toBeVisible();
    await expect(reason).not.toHaveText("");

    // The reason is announced with the control, not merely painted near it.
    const reasonId = await reason.getAttribute("id");
    expect(reasonId, "the reason line carries an id").toBeTruthy();
    expect(
      (await submit.getAttribute("aria-describedby"))?.split(/\s+/) ?? [],
      "submit aria-describedby names the reason",
    ).toContain(reasonId);
  });
});

/**
 * The owner's Stage-review finding (#1667) in its own tier: the card sits on the
 * vertical axis of the frame rather than riding the top edge. It needs a viewport
 * tall enough for the card to fit with room to spare — otherwise "centred" and
 * "top-pinned" are the same picture and the assertion would prove nothing.
 */
test.describe("021 EARS-1: the vertical axis", () => {
  test.use({ viewport: { width: 1440, height: 1200 } });

  test("021 EARS-1.8: the card is centred on the vertical axis, not pinned to the top", async ({
    page,
  }) => {
    await page.goto("/register");

    const card = page.getByTestId("registration-form-card");
    const box = await card.boundingBox();
    expect(box, "the form card has a layout box").not.toBeNull();
    const viewport = page.viewportSize();
    expect(viewport, "the test declares a viewport").not.toBeNull();

    // Centred means the space above the card equals the space below it. The card
    // is shorter than the viewport at this size, so the two gaps are real; a
    // top-pinned card would leave the whole remainder below it. The tolerance
    // absorbs sub-pixel rounding and the wordmark row's asymmetric contribution,
    // and is far tighter than the difference a top-aligned layout produces.
    const above = box!.y;
    const below = viewport!.height - (box!.y + box!.height);
    expect(below, "the card is shorter than the viewport").toBeGreaterThan(0);
    expect(
      Math.abs(above - below),
      `vertical centring: ${above}px above vs ${below}px below`,
    ).toBeLessThanOrEqual(48);
  });
});

test.describe("021 EARS-1: the 390 collapse", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("021 EARS-1.7: at 390 the brand panel drops and the form column stands alone", async ({
    page,
  }) => {
    await page.goto("/register");

    await expect(page.getByTestId("auth-brand-panel")).toBeHidden();
    // The one-logo-per-viewport rule inverted: with the panel gone the
    // form-column lockup is what carries the brand.
    await expect(page.getByTestId("auth-wordmark")).toBeVisible();
    await expect(page.getByTestId("registration-form-card")).toBeVisible();
    await expect(page.getByTestId("register-email")).toBeVisible();
    await expect(page.getByTestId("register-promo")).toBeVisible();

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflows, "horizontal overflow at 390").toBe(false);
  });
});
