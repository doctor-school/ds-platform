import { test, expect } from "@playwright/test";

/**
 * 021 EARS-5 — the two-tier consent block on the doctor registration door
 * (F-021-1 «Б», the owner's pick).
 *
 * The browser tier of the clause, and the only tier that can prove what it
 * actually asserts. The requirement is about RENDERING: two tiers, the access
 * conditions framed together above the submit and the optional opt-in standing
 * separately below it, «distinguishable by their rendering and not by wording
 * alone» — and the two rejected variants structurally absent, not merely
 * unmentioned. None of that is reachable from a unit test.
 *
 * Backend-free tier (`playwright.ci.config.ts`): the command is still not wired
 * — the bot-protection client half (EARS-19, #1558) is the last unmet
 * precondition — so what is pinned here is the CLIENT half of EARS-5. The
 * server half (the command refused without `partner-data-sharing`, and the
 * versioned dated row written when it has it) is proven in
 * `apps/api/test/storefront/doctor-register-consents.e2e-spec.ts`.
 *
 * EARS-6's optionality guarantees live in `register-consent-optional.spec.ts`
 * (#1542); this file asserts only «never pre-ticked», which EARS-5 needs for its
 * own tier-2 render.
 */

/**
 * The partner-data consent's words, verbatim from the package default
 * (`packages/auth-flow/src/copy/defaults.ts` -> `consents.partnerDataItem`),
 * which is itself verbatim from the vendored canvas `design-source/auth.dc.html`.
 * No host restates them, so what the doctor reads here IS the approved wording.
 */
const PARTNER_DATA_LABEL = "Согласие на передачу данных партнёрам платформы";
const PARTNER_DATA_HELP =
  "Это условие бесплатного для врача обучения: без согласия часть материалов недоступна.";

/**
 * The data composition is disclosed in the policy text and by the platform
 * manager, never enumerated inside the consent row (021 EARS-5). These are the
 * field names the superseded sentence used to list; the row must carry none.
 */
const COMPOSITION = ["ФИО", "специальность", "город", "место работы"];

/**
 * The package's own words for an ungranted access condition — the text the
 * canvas (193/201) stands under the row it belongs to, after the press.
 */
const DECLARATION_UNMET =
  "Отметьте, что вы медицинский работник — без этого регистрация невозможна.";
const PARTNER_UNMET =
  "Отметьте согласие на передачу данных партнёрам — без него регистрация невозможна.";

test.describe("021 EARS-5: the two-tier consent block", () => {
  test("021 EARS-5.1: two tiers in the F-021-1 geometry — access conditions framed above the submit, marketing below it", async ({
    page,
  }) => {
    await page.goto("/register");

    const tier1 = page.getByTestId("registration-consent-access");
    const tier2 = page.getByTestId("registration-consent-marketing");
    await expect(tier1).toHaveCount(1);
    await expect(tier2).toHaveCount(1);

    // Both access conditions are INSIDE tier 1's frame; the marketing opt-in is
    // not — that containment IS the two-tier structure.
    await expect(
      tier1.getByTestId("register-medworker"),
      "the declaration is inside the access-conditions frame",
    ).toHaveCount(1);
    await expect(
      tier1.getByTestId("register-partner-data"),
      "the partner-data consent is inside the access-conditions frame",
    ).toHaveCount(1);
    await expect(
      tier1.getByTestId("register-marketing"),
      "the marketing opt-in is NOT an access condition",
    ).toHaveCount(0);

    // DOM order: tier 1 → submit → tier 2. Asserted on the document itself
    // rather than on coordinates, so it holds at every viewport.
    const order = await page.evaluate(() => {
      const at = (id: string) =>
        document.querySelector(`[data-testid="${id}"]`);
      const nodes = [
        at("registration-consent-access"),
        at("register-submit"),
        at("registration-consent-marketing"),
      ];
      if (nodes.some((node) => node === null)) return null;
      return [
        nodes[0]!.compareDocumentPosition(nodes[1]!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        nodes[1]!.compareDocumentPosition(nodes[2]!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ].map(Boolean);
    });
    expect(order, "tier 1 precedes the submit, which precedes tier 2").toEqual([
      true,
      true,
    ]);

    // «Distinguishable by their rendering»: tier 1 carries a real frame, tier 2
    // does not. Read from computed style, never from copy.
    const framed = await tier1.evaluate((el) => {
      const style = getComputedStyle(el);
      return Number.parseFloat(style.borderTopWidth);
    });
    const unframed = await tier2.evaluate((el) =>
      Number.parseFloat(getComputedStyle(el).borderTopWidth),
    );
    expect(framed, "tier 1 is a bordered group").toBeGreaterThan(0);
    expect(unframed, "tier 2 stands outside that group").toBe(0);
  });

  test("021 EARS-5.2: the partner-data row carries the canvas wording, and the composition is not enumerated in it", async ({
    page,
  }) => {
    await page.goto("/register");

    // The row is RENDERED, in the shared words: label above, help line below,
    // both byte-identical to the package default no host overrides.
    const statement = page.getByTestId("register-partner-data-statement");
    await expect(statement).toHaveCount(1);
    await expect(statement).toBeVisible();
    expect((await statement.textContent())?.trim()).toBe(PARTNER_DATA_LABEL);

    const help = page.getByTestId("register-partner-data-help");
    await expect(help).toHaveCount(1);
    await expect(help).toBeVisible();
    expect((await help.textContent())?.trim()).toBe(PARTNER_DATA_HELP);

    // The composition belongs to the policy text and to the platform manager,
    // never to the consent row — the superseded sentence is structurally gone,
    // not merely reworded.
    const tier1Text = (await page
      .getByTestId("registration-consent-access")
      .textContent()) ?? "";
    for (const field of COMPOSITION) {
      expect(
        tier1Text,
        `the access tier does not enumerate ${field}`,
      ).not.toContain(field);
    }
    expect(tier1Text).not.toContain("Контакты не передаются");

    // EARS-7 — withdrawal is a manager-side case: the surface carries no
    // self-service control and no withdrawal sentence (owner 2026-09-24).
    await expect(
      page.getByTestId("registration-consent-manager-note"),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /отозвать|отзыв/i }),
      "no self-service withdrawal control",
    ).toHaveCount(0);
  });

  test("021 EARS-5.3: neither rejected variant is built — no flat list, no expandable disclosure", async ({
    page,
  }) => {
    await page.goto("/register");

    const tier1 = page.getByTestId("registration-consent-access");
    const tier2 = page.getByTestId("registration-consent-marketing");

    // Variant В — the data composition behind a disclosure. Nothing in either
    // tier opens, expands or collapses.
    for (const [name, tier] of [
      ["tier 1", tier1],
      ["tier 2", tier2],
    ] as const) {
      await expect(
        tier.locator("details, summary"),
        `${name} carries no disclosure widget`,
      ).toHaveCount(0);
      await expect(
        tier.locator("[aria-expanded], [aria-controls]"),
        `${name} carries no expandable control`,
      ).toHaveCount(0);
    }

    // Variant А — one flat list of every consent. Exactly two tier containers
    // exist, and the three consent controls are split across them 2 / 1.
    await expect(
      page.locator(
        '[data-testid="registration-consent-access"], [data-testid="registration-consent-marketing"]',
      ),
    ).toHaveCount(2);
    await expect(tier1.locator('input[type="checkbox"]')).toHaveCount(2);
    await expect(tier2.locator('input[type="checkbox"]')).toHaveCount(1);
  });

  test("021 EARS-5.4: neither consent is pre-ticked, and each unmet access condition is reported on its own row", async ({
    page,
  }) => {
    await page.goto("/register");

    const declaration = page.getByTestId("register-medworker");
    const partnerData = page.getByTestId("register-partner-data");
    const marketing = page.getByTestId("register-marketing");

    // The platform never consents on the doctor's behalf — access condition or
    // opt-in alike.
    await expect(declaration).not.toBeChecked();
    await expect(partnerData).not.toBeChecked();
    await expect(marketing).not.toBeChecked();

    // Nothing is said before the press — the canvas shows the warning lines
    // only in its `submitted` state (369/193/201).
    const declarationItem = page.getByTestId("register-medworker-item");
    const partnerItem = page.getByTestId("register-partner-data-item");
    await expect(declarationItem).not.toContainText(DECLARATION_UNMET);
    await expect(partnerItem).not.toContainText(PARTNER_UNMET);
    await expect(page.getByTestId("register-submit")).toBeEnabled();

    // Pressed with both ungranted: BOTH rows report, each in its own words,
    // rather than one line beside the button naming one condition at a time.
    await page.getByTestId("register-submit").click();
    await expect(declarationItem).toContainText(DECLARATION_UNMET);
    await expect(partnerItem).toContainText(PARTNER_UNMET);

    // Granting one clears ONLY its own report; the other still stands.
    await declaration.locator("xpath=ancestor::label[1]").click();
    await expect(declaration).toBeChecked();
    await expect(declarationItem).not.toContainText(DECLARATION_UNMET);
    await expect(partnerItem).toContainText(PARTNER_UNMET);

    // With BOTH granted nothing is left to report, and the submit — live the
    // whole time, exactly as the canvas draws it — opens the door.
    await partnerData.locator("xpath=ancestor::label[1]").click();
    await expect(partnerData).toBeChecked();
    await expect(partnerItem).not.toContainText(PARTNER_UNMET);
    await expect(page.getByTestId("register-submit")).toBeEnabled();
  });
});
