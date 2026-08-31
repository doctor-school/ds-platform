import { test, expect, type Page } from "@playwright/test";

/**
 * 021 EARS-1 — the doctor registration route inside 017's shell.
 *
 * The browser tier of the EARS-1 contract, and the only tier that can prove what
 * the clause actually asserts: that the route renders the `auth` canvas's split
 * composition INSIDE the 017 shell (rather than beside a screen-local copy of
 * it), that the door asks for exactly three things, and that no document is ever
 * requested at it (REQ-22 — the feature's central product promise).
 *
 * On REQ-22 and the word «документ». The requirement (021-requirements-en §112)
 * bans the *request*: "no upload control, no file input, no document field and no
 * «прикрепите диплом» copy". It does not ban the promise — the canvas card head
 * says «Документы на входе не нужны.», which is REQ-22 being *stated to the
 * doctor*, and 021-product.md builds the whole positioning on it. So 1.3 scans
 * for request-shaped tells and asserts the promise is present, instead of
 * banning a substring. The scan is scoped to the registration screen for a second
 * reason too: the 017 shell's own footer carries «Документы и контакты» (see
 * `shell.spec.ts` → `footer-documents`), which a document-wide scan would flag.
 *
 * Scope of this slice: layout only. The envelope's other slots (return context,
 * attribution, points promise, consent tiers — #1538/#1540/#1541/#1544/#1545) are
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
    page.locator('input[type="file"], [accept], [role="button"][aria-label*="файл" i]'),
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

test.describe("021 EARS-1: the registration route inside the 017 shell", () => {
  test("021 EARS-1.1: the split composition renders inside the shell, not beside it", async ({
    page,
  }) => {
    await page.goto("/register");

    await expect(page.getByTestId("registration-screen")).toBeVisible();
    // Inside the shell's `main` — the route group's layout is what wraps it.
    await expect(
      page
        .getByTestId("storefront-shell")
        .locator("main")
        .getByTestId("registration-screen"),
    ).toHaveCount(1);

    const screen = page.getByTestId("registration-screen");
    // The canvas's two halves: the navy brand panel and the bordered form card.
    await expect(screen.getByTestId("registration-brand-panel")).toBeVisible();
    await expect(screen.getByTestId("registration-form-card")).toBeVisible();
    // The route owns the document's single h1 (the shell layout carries none).
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
    expect(await promo.getAttribute("aria-required"), "promo aria-required").not.toBe(
      "true",
    );
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

  test("021 EARS-1.4: the route contributes no header or footer of its own", async ({
    page,
  }) => {
    await page.goto("/register");

    await expect(page.locator("header")).toHaveCount(1);
    await expect(page.locator("footer")).toHaveCount(1);

    const screen = page.getByTestId("registration-screen");
    await expect(screen.locator("header")).toHaveCount(0);
    await expect(screen.locator("footer")).toHaveCount(0);
    await expect(screen.getByTestId("storefront-header")).toHaveCount(0);
    await expect(screen.getByTestId("storefront-footer")).toHaveCount(0);
    await expect(screen.locator("nav")).toHaveCount(0);
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
      await expect(page.getByTestId(slot), `unfilled slot ${slot}`).toHaveCount(0);
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

test.describe("021 EARS-1: the 390 collapse", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("021 EARS-1.7: at 390 the brand panel drops and the form column stands alone", async ({
    page,
  }) => {
    await page.goto("/register");

    await expect(page.getByTestId("registration-brand-panel")).toBeHidden();
    await expect(page.getByTestId("registration-form-card")).toBeVisible();
    await expect(page.getByTestId("register-email")).toBeVisible();
    await expect(page.getByTestId("register-promo")).toBeVisible();

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflows, "horizontal overflow at 390").toBe(false);
  });
});
