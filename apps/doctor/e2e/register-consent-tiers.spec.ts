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
 * EARS-6's optionality guarantees are #1542's and are deliberately NOT asserted
 * here beyond «never pre-ticked», which EARS-5 needs for its own tier-2 render.
 */

/** The composition the statement must name, from the 021 read model. */
const COMPOSITION = ["ФИО", "специальность", "город", "место работы"];

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

  test("021 EARS-5.2: the partner-data statement names the exact composition and says contacts are not shared", async ({
    page,
  }) => {
    await page.goto("/register");

    const statement = page.getByTestId("register-partner-data-statement");
    await expect(statement).toHaveCount(1);

    const text = (await statement.textContent()) ?? "";
    for (const field of COMPOSITION) {
      expect(text, `the statement names ${field}`).toContain(field);
    }
    // The exclusion is STATED, not implied by omission.
    expect(text).toContain("Контакты не передаются");
    expect(text).toBe(
      "Согласен на передачу партнёрам платформы данных: ФИО, специальность, город, место работы. Контакты не передаются.",
    );

    // EARS-7 — a change or withdrawal is a manager request, and there is no
    // self-service control anywhere on the surface.
    await expect(
      page.getByTestId("registration-consent-manager-note"),
    ).toContainText("через менеджера платформы");
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

  test("021 EARS-5.4: neither consent is pre-ticked, and the reason line names whichever access condition is unmet", async ({
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

    const reason = page.getByTestId("register-submit-reason");
    await expect(reason).toContainText("медицинский работник");

    // With the declaration granted, the stated obstacle moves to the second
    // access condition — the real unmet one, named in the doctor's words.
    await declaration.locator("xpath=ancestor::label[1]").click();
    await expect(declaration).toBeChecked();
    await expect(reason).toContainText("передачу данных партнёрам");

    // With BOTH granted, nothing is left to state: 021 EARS-19 (#1558) wired the
    // command behind an INVISIBLE challenge that runs inside the submit, so the
    // challenge is not an obstacle the doctor must clear first. The reason line
    // is ABSENT rather than re-worded, and the door opens.
    await partnerData.locator("xpath=ancestor::label[1]").click();
    await expect(partnerData).toBeChecked();
    await expect(reason).toHaveCount(0);
    await expect(page.getByTestId("register-submit")).toBeEnabled();
  });
});
