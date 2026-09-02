import { test, expect, type Page } from "@playwright/test";

/**
 * 021 EARS-2 (#1538) — the return context in the left half of the split.
 *
 * The browser tier of the clause, and the only tier that can prove what it
 * actually asserts. Three things have to hold together, and none of them is
 * observable from a unit test of the card:
 *
 *   1. the event the doctor came for renders in the SPLIT'S LEFT HALF — the
 *      brand panel — on the wide layout, through the ONE canonical event-card
 *      unit (`data-webinar-card`, `@ds/design-system`), never a second card
 *      built for this surface;
 *   2. NO back-navigation control exists anywhere in that card's subtree — the
 *      owner's explicit condition on the Stage-A pick F-021-2 Б, asserted as a
 *      count of zero links and zero buttons so no future addition can slip one
 *      in;
 *   3. with no resolvable `from` the slot is ABSENT from the tree rather than
 *      an empty frame, and the form stays fully usable (EARS-3's honest-empty
 *      rule; EARS-3's own fuller direct-arrival copy is #1539, not this slice).
 *
 * Plus the 390 collapse of EARS-16: the same card becomes the background plate
 * ABOVE the form, and exactly one of the two renders per viewport.
 *
 * The tier boots the app against `e2e/support/return-context-api.mjs`
 * (`playwright.return-context.config.ts`) because `?from=` is resolved
 * SERVER-side, before any byte the browser could intercept.
 */

/** The slug the upstream double answers for; anything else is a real 404. */
const KNOWN = "prp-pri-gonartroze";
const TITLE = "PRP при гонартрозе: показания, протоколы, ошибки";

/** The invariant, asserted over the whole subtree rather than element by element. */
async function expectNoWayBack(page: Page, testId: string) {
  const card = page.getByTestId(testId).locator("[data-webinar-card]");
  await expect(card).toHaveCount(1);
  await expect(
    card.locator("a"),
    "a link inside the return-context card",
  ).toHaveCount(0);
  await expect(
    card.locator("button"),
    "a button inside the return-context card",
  ).toHaveCount(0);
}

test.describe("021 EARS-2: the return context on the wide layout", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("021 EARS-2.1: the gate event renders in the split's left half through the shared card unit", async ({
    page,
  }) => {
    await page.goto(`/register?from=${KNOWN}`);

    const panel = page.getByTestId("return-context-panel");
    await expect(panel).toBeVisible();
    // The left half IS the brand panel — the context takes the place of its
    // value prop rather than standing anywhere else on the page.
    await expect(
      page.getByTestId("auth-brand-panel").getByTestId("return-context-panel"),
    ).toHaveCount(1);
    await expect(panel).toContainText("Вы вернётесь к этому событию");
    await expect(panel.locator("[data-webinar-card]")).toContainText(TITLE);
    await expect(panel.locator("[data-webinar-card]")).toContainText(
      "Школа ортобиологии",
    );
    // Rendered in МСК, the event's own clock (EARS-12) — the double's instant
    // is 16:00Z, which is 19:00 in Europe/Moscow.
    await expect(panel.locator("[data-webinar-card]")).toContainText("19:00");
    await expect(panel.locator("[data-webinar-card]")).toContainText("МСК");

    // The panel is genuinely to the LEFT of the form column (#237 column order).
    const panelBox = await panel.boundingBox();
    const formBox = await page
      .getByTestId("registration-form-card")
      .boundingBox();
    expect(panelBox && formBox).toBeTruthy();
    expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(formBox!.x + 1);

    // The form is untouched by the context beside it.
    await expect(page.getByTestId("register-email")).toBeVisible();
    await expect(page.getByTestId("register-password")).toBeVisible();
  });

  test("021 EARS-2.2: the card carries no back-navigation control at all", async ({
    page,
  }) => {
    await page.goto(`/register?from=${KNOWN}`);
    await expectNoWayBack(page, "return-context-panel");
  });

  test("021 EARS-2.3: exactly one return-context render exists per viewport", async ({
    page,
  }) => {
    await page.goto(`/register?from=${KNOWN}`);

    await expect(page.getByTestId("return-context-panel")).toBeVisible();
    // The mobile plate is in the DOM but `display:none` at this width, so the
    // event is announced ONCE — the same one-per-viewport rule the wordmark has.
    await expect(page.getByTestId("return-context-plate")).toBeHidden();
    await expect(page.locator("[data-webinar-card]:visible")).toHaveCount(1);
  });

  test("021 EARS-2.4: with no return context the slot is absent, not an empty frame", async ({
    page,
  }) => {
    await page.goto("/register");

    await expect(page.getByTestId("return-context-panel")).toHaveCount(0);
    await expect(page.getByTestId("return-context-plate")).toHaveCount(0);
    await expect(page.getByTestId("registration-return-context")).toHaveCount(0);
    await expect(page.locator("[data-webinar-card]")).toHaveCount(0);
    // The left half falls back to the brand panel's value prop — the panel is
    // still there, it just carries no reserved or dashed context frame.
    await expect(page.getByTestId("auth-brand-panel")).toBeVisible();
    await expect(page.getByTestId("registration-form-card")).toBeVisible();
    await expect(page.getByTestId("register-email")).toBeVisible();
  });

  test("021 EARS-2.5: an unresolvable `from` is absence too, never a broken card", async ({
    page,
  }) => {
    // A real not-found from the api — a stale, deleted or draft event, and the
    // shape a hand-typed URL takes. It must degrade to the same absence as no
    // param at all rather than surfacing an error on the door.
    await page.goto("/register?from=net-takogo-sobytiya");

    await expect(page.getByTestId("return-context-panel")).toHaveCount(0);
    await expect(page.locator("[data-webinar-card]")).toHaveCount(0);
    await expect(page.getByTestId("registration-form-card")).toBeVisible();
    await expect(page.getByTestId("register-email")).toBeVisible();
  });
});

test.describe("021 EARS-2: the 390 collapse", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("021 EARS-2.6: at 390 the same card is the background plate above the form", async ({
    page,
  }) => {
    await page.goto(`/register?from=${KNOWN}`);

    const plate = page.getByTestId("return-context-plate");
    await expect(plate).toBeVisible();
    await expect(plate.locator("[data-webinar-card]")).toContainText(TITLE);
    // The panel render is gone with the brand panel itself.
    await expect(page.getByTestId("return-context-panel")).toBeHidden();
    await expect(page.locator("[data-webinar-card]:visible")).toHaveCount(1);

    // ABOVE the form, not beside or below it.
    const plateBox = await plate.boundingBox();
    const formBox = await page
      .getByTestId("registration-form-card")
      .boundingBox();
    expect(plateBox && formBox).toBeTruthy();
    expect(plateBox!.y + plateBox!.height).toBeLessThanOrEqual(formBox!.y + 1);

    await expectNoWayBack(page, "return-context-plate");

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflows, "horizontal overflow at 390").toBe(false);
  });
});
