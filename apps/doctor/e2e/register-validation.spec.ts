import { test, expect, devices, type Page, type Request } from "@playwright/test";

/**
 * 021 EARS-11 (#1547) — the RENDERED half of the per-field validation contract.
 *
 * The contract itself is pinned one tier down
 * (`packages/schemas/src/storefront/register-fields.spec.ts` for the FieldSpec
 * table, `apps/doctor/lib/register-fields.test.ts` for its react-hook-form
 * projection). What only a browser can prove is what the DOCTOR meets: which
 * message appears in which slot, that the password hint and its error share ONE
 * slot (003 EARS-37, owner decision Б — hint OR error, never both), that a
 * pasted promo code is trimmed rather than rejected, and — the reason LD-9
 * exists — that the confirmation code accepts what a phone keyboard actually
 * produces.
 *
 * Backend-free tier (`playwright.ci.config.ts`): the `/v1/*` commands are
 * intercepted at the network boundary, which is what makes the verified REQUEST
 * assertable — the code that leaves the browser, not the glyphs on screen.
 */
const REGISTER_ROUTE = "**/v1/storefront/doctor/register";
const VERIFY_ROUTE = "**/v1/auth/verify";

const EMAIL = "doctor@clinic.ru";
const PASSWORD = "correct horse battery";

const PASSWORD_HINT = "Не менее 8 символов.";
const PASSWORD_TOO_SHORT = "Пароль слишком короткий — нужно не менее 8 символов.";
const EMAIL_MALFORMED = "Проверьте адрес: он должен быть вида doctor@clinic.ru.";
const PROMO_TOO_LONG =
  "Промокод длиннее 64 символов — проверьте, что скопировали только код.";

/**
 * The message slot a control is described by.
 *
 * `FormControl` points `aria-describedby` at the FormMessage in both states —
 * the description id while the field is clean, the message id once it errors —
 * so the LAST token always resolves the one slot this field owns. Reading the
 * slot through the accessibility wiring, rather than by text, is what lets the
 * hint-OR-error assertion be about the SLOT and not about the page.
 */
async function messageSlot(page: Page, testId: string) {
  const describedBy =
    (await page.getByTestId(testId).getAttribute("aria-describedby")) ?? "";
  const id = describedBy.trim().split(/\s+/).at(-1);
  expect(id, `${testId} is wired to a message slot`).toBeTruthy();
  return page.locator(`#${id}`);
}

/** Tick a consent through its label — the checkbox primitive's own hit area. */
async function tick(page: Page, testId: string) {
  await page.getByTestId(testId).locator("xpath=ancestor::label[1]").click();
  await expect(page.getByTestId(testId)).toBeChecked();
}

function body(request: Request): Record<string, unknown> {
  return JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
}

test.describe("021 EARS-11: per-field validation on the registration door", () => {
  test("021 EARS-11.1: a malformed address is stated in the email field, and a valid one clears it", async ({
    page,
  }) => {
    await page.goto("/register");

    const email = page.getByTestId("register-email");
    await email.fill("doctor-at-clinic");
    await email.blur();

    // `toContainText`, not `toHaveText`: an erroring FormMessage prefixes the
    // primitive's own «⚠» affordance, which is the design system's to own — the
    // assertion is about the SENTENCE this feature supplies.
    await expect(await messageSlot(page, "register-email")).toContainText(
      EMAIL_MALFORMED,
    );
    // The error belongs to the field that carries it — `errorSlot: "field"`.
    await expect(email).toHaveAttribute("aria-invalid", "true");

    await email.fill(EMAIL);
    await email.blur();
    // Cleared means GONE: a field with no error and no hint renders no message
    // element at all, so the statement is absent rather than blank.
    await expect(page.getByText(EMAIL_MALFORMED)).toHaveCount(0);
    await expect(email).not.toHaveAttribute("aria-invalid", "true");
  });

  test("021 EARS-11.2: the password error REPLACES the hint in the single shared slot, and the hint returns", async ({
    page,
  }) => {
    await page.goto("/register");

    // Pre-submit: the slot carries the hint, which is the whole pre-submit
    // affordance — the rule is stated before it is enforced.
    await expect(await messageSlot(page, "register-password")).toHaveText(
      PASSWORD_HINT,
    );

    const password = page.getByTestId("register-password");
    await password.fill("short12");
    await password.blur();

    // 003 EARS-37, owner decision Б — ONE slot: the error replaces the hint,
    // never stacks under it, and it restates the same rule so nothing is lost.
    const slot = await messageSlot(page, "register-password");
    await expect(slot).toContainText(PASSWORD_TOO_SHORT);
    await expect(
      page.getByText(PASSWORD_HINT, { exact: true }),
      "the hint is replaced, not doubled",
    ).toHaveCount(0);

    await password.fill("longenough");
    await password.blur();
    await expect(await messageSlot(page, "register-password")).toHaveText(
      PASSWORD_HINT,
    );
  });

  test("021 EARS-11.3: an over-long promo code is stated, a pasted one is trimmed, and the bound itself is accepted", async ({
    page,
  }) => {
    await page.goto("/register");

    const promo = page.getByTestId("register-promo");
    await promo.fill("D".repeat(65));
    await promo.blur();
    await expect(await messageSlot(page, "register-promo")).toContainText(
      PROMO_TOO_LONG,
    );

    // Trim, not rejection: the paste case design §7 asks for. Trimming happens
    // on BLUR so an interior space stays typable.
    await promo.fill("  DS-2026  ");
    await promo.blur();
    await expect(promo).toHaveValue("DS-2026");
    await expect(page.getByText(PROMO_TOO_LONG)).toHaveCount(0);
    await expect(promo).not.toHaveAttribute("aria-invalid", "true");

    // The bound is inclusive — 64 is a valid promo code, not a long one.
    await promo.fill("D".repeat(64));
    await promo.blur();
    await expect(page.getByText(PROMO_TOO_LONG)).toHaveCount(0);
    await expect(promo).not.toHaveAttribute("aria-invalid", "true");
  });
});

/**
 * iPhone 13 emulation MINUS `defaultBrowserType`: a describe-level `use()` may
 * not switch browser engines (it would force a new worker), and the engine is
 * not what this test is about — the phone-shaped viewport, the mobile UA and
 * touch are, because they are what selects the on-screen keyboard `inputMode`
 * addresses.
 */
const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } =
  devices["iPhone 13"];

test.describe("021 EARS-11: the confirmation code on a phone", () => {
  test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

  test("021 EARS-11.4: a lowercase-typed alphanumeric code is reachable, untransformed and verifies", async ({
    page,
  }) => {
    await page.route(REGISTER_ROUTE, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "pending_verification" }),
      }),
    );
    await page.route(VERIFY_ROUTE, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "verified" }),
      }),
    );

    await page.goto("/register");
    await page.getByTestId("register-email").fill(EMAIL);
    await page.getByTestId("register-password").fill(PASSWORD);
    await tick(page, "register-medworker");
    await tick(page, "register-partner-data");
    await page.getByTestId("register-submit").click();

    await expect(page.getByTestId("verify-submit")).toBeVisible();

    // #1110 — the emitted code carries LETTERS, so a digits-only keypad would
    // make it untypable on the device this test emulates.
    const code = page.locator('input[autocomplete="one-time-code"]');
    await expect(code).toHaveAttribute("inputmode", "text");

    // LD-9 — no CSS uppercase transform anywhere in the slot row: the value is
    // normalised, the glyphs are never restyled, so what the doctor sees is
    // what they typed.
    const slots = page.locator("div.aspect-square");
    await expect(slots).toHaveCount(6);
    const transforms = await slots.evaluateAll((nodes) =>
      nodes.map((node) => getComputedStyle(node).textTransform),
    );
    expect(transforms).toEqual(Array.from({ length: 6 }, () => "none"));

    // The proof the field is typed for the REAL code: a lowercase code passes
    // the client guard and leaves the browser in the case the engine expects.
    const [request] = await Promise.all([
      page.waitForRequest(VERIFY_ROUTE),
      code.fill("abc123"),
    ]);
    expect(body(request)).toEqual({ email: EMAIL, code: "ABC123" });

    await expect(page.getByTestId("verify-succeeded")).toBeVisible();
  });
});
