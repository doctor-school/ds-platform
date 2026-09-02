import { test, expect } from "@playwright/test";

/**
 * 021 EARS-4 — the mandatory medical-worker declaration on the registration
 * door.
 *
 * The browser tier of the clause, and the only tier that can prove what it
 * actually asserts: that the declaration is present with its plain-language
 * legal reason, that it is a DECLARATION and not a verification (nothing is
 * asked to support it), and — the half a unit test cannot reach — that the
 * surface offers no way around it: no «ask later», no «пропустить», no partial
 * variant, and no state in which the submit becomes reachable without it.
 *
 * Backend-free tier (`playwright.ci.config.ts`): the command is not wired in
 * this slice — the partner-data consent (EARS-5, #1541) and the bot-protection
 * client half (EARS-19, #1558) are both preconditions of it — so what is pinned
 * here is the CLIENT half of EARS-4: the control, its copy, the absence of an
 * escape hatch, and the EARS-12 reason line naming the declaration by name while
 * it is unticked. The server half — the command refusing without the
 * declaration, and writing the versioned dated consent row when it has it —
 * is proven in `apps/api/test/storefront/doctor-register-consents.e2e-spec.ts`.
 */

/** Copy or controls that would offer a way PAST the declaration (EARS-4). */
const ESCAPE_HATCH_TELLS = [
  "позже",
  "потом",
  "пропустить",
  "пропустите",
  "не сейчас",
  "напомнить",
  "уточню",
  "заполню позднее",
];

test.describe("021 EARS-4: the mandatory medical-worker declaration", () => {
  test("021 EARS-4.1: the declaration renders with its legal explanation and is not pre-ticked", async ({
    page,
  }) => {
    await page.goto("/register");

    const declaration = page.getByTestId("register-medworker");
    await expect(declaration).toHaveAttribute("type", "checkbox");
    // Never pre-ticked: the platform does not declare on the doctor's behalf.
    await expect(declaration).not.toBeChecked();

    // The canvas copy, verbatim — the label, its «обязательно» tag and the
    // plain-language statement of WHY it is required.
    const item = page.getByTestId("register-medworker-item");
    await expect(item).toContainText("Я являюсь медицинским работником");
    await expect(item).toContainText("обязательно");
    await expect(page.getByTestId("register-medworker-help")).toHaveText(
      "Требование закона: часть материалов доступна только медицинским работникам.",
    );
  });

  test("021 EARS-4.2: the declaration stands ABOVE the submit, inside the form", async ({
    page,
  }) => {
    await page.goto("/register");

    // Tier 1 is framed with the access conditions above the submit button
    // (EARS-5 / design §1) — the declaration is not a footnote under it.
    const order = await page.evaluate(() => {
      const box = document.querySelector('[data-testid="register-medworker"]');
      const submit = document.querySelector('[data-testid="register-submit"]');
      if (!box || !submit) return null;
      return {
        inForm: Boolean(box.closest('[data-testid="registration-form"]')),
        // Node.DOCUMENT_POSITION_FOLLOWING === 4
        submitFollowsBox: Boolean(box.compareDocumentPosition(submit) & 4),
      };
    });
    expect(order).toEqual({ inForm: true, submitFollowsBox: true });
  });

  test("021 EARS-4.3: registration cannot be submitted without the declaration, and the reason names it", async ({
    page,
  }) => {
    await page.goto("/register");

    const submit = page.getByTestId("register-submit");
    await expect(submit).toBeDisabled();
    // EARS-12: the reason beside the disabled control names the SPECIFIC unmet
    // condition, in the canvas's own words — not a generic «заполните форму».
    await expect(page.getByTestId("register-submit-reason")).toHaveText(
      "Отметьте, что вы медицинский работник — без этого регистрация невозможна.",
    );
    // …and it is announced with the control, not merely placed near it.
    const describedBy = await submit.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`#${describedBy}`)).toHaveText(
      "Отметьте, что вы медицинский работник — без этого регистрация невозможна.",
    );
  });

  test("021 EARS-4.4: filling every other field still does not open the door without the declaration", async ({
    page,
  }) => {
    await page.goto("/register");

    await page.getByTestId("register-email").fill("doctor@clinic.ru");
    await page.getByTestId("register-password").fill("supersecret1");
    await page.getByTestId("register-promo").fill("DS-2026");
    await page.getByTestId("register-password").blur();

    // No «complete the rest and we will ask later» path exists: with the whole
    // form valid and the declaration unticked, the submit is still refused and
    // the stated reason is still the declaration.
    await expect(page.getByTestId("register-submit")).toBeDisabled();
    await expect(page.getByTestId("register-submit-reason")).toHaveText(
      "Отметьте, что вы медицинский работник — без этого регистрация невозможна.",
    );

    // Ticking it clears THAT obstacle — the reason moves on to the next real
    // one rather than repeating the declaration.
    await page.getByTestId("register-medworker").check();
    await expect(page.getByTestId("register-medworker")).toBeChecked();
    await expect(page.getByTestId("register-submit-reason")).not.toHaveText(
      "Отметьте, что вы медицинский работник — без этого регистрация невозможна.",
    );
  });

  test("021 EARS-4.5: the declaration asks for no document and offers no «ask later» affordance", async ({
    page,
  }) => {
    await page.goto("/register");

    // A declaration, not a verification: nothing is requested to support it,
    // in either state of the checkbox.
    for (const state of ["unticked", "ticked"] as const) {
      if (state === "ticked") await page.getByTestId("register-medworker").check();

      await expect(
        page.locator('input[type="file"], [accept]'),
        `upload affordance beside the declaration (${state})`,
      ).toHaveCount(0);

      const text = (
        await page.getByTestId("registration-screen").innerText()
      ).toLowerCase();
      for (const tell of ESCAPE_HATCH_TELLS) {
        expect(
          text,
          `«${tell}» offers a way past the declaration (${state})`,
        ).not.toContain(tell);
      }
    }

    // Exactly ONE declaration control — no partial variant standing beside it.
    await expect(page.getByTestId("register-medworker")).toHaveCount(1);
  });
});
