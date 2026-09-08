import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";

/**
 * 021 EARS-16 (#1552) — the registration route at the mobile breakpoint, in
 * BOTH themes, with the accessibility bar the clause names.
 *
 * What this file proves, and why none of it is proven anywhere else on main:
 *
 *   1. PARITY, not a mobile smoke test. Every release-1 state of the route is
 *      driven at 390x844 AND at 1440x900, in the light theme AND in the dark
 *      one, with and without a return context — the full matrix the clause
 *      writes out (021-requirements-en, EARS-16). Each case asserts three
 *      things only a real browser can see: the intended theme is the one
 *      actually painted, the document does not scroll horizontally and the
 *      screen does not reach past the viewport's right edge, and the state's
 *      primary control is present, visible and operable rather than merely
 *      rendered.
 *   2. The DARK theme against axe. `a11y-axe.e2e.spec.ts:113-230` already scans
 *      `/register` with the WCAG 2 A/AA rule set — but in the light theme, at
 *      the desktop viewport, for five states and without a return context. That
 *      file is the baseline; this one adds the axes it does not have. The dark
 *      arm is the load-bearing one: nothing on main checks dark-theme contrast
 *      on this route, and contrast is exactly what a theme swap breaks.
 *   3. The network-failure state, which the baseline scan does not drive at all.
 *
 * Plus four accessibility contracts of the route that are viewport- and
 * theme-independent, and are therefore driven once rather than 48 times: every
 * consent checkbox is a labelled control, every field error is programmatically
 * associated with its input, the disabled submit states its reason to assistive
 * technology, and the two consent tiers are separated in the accessibility tree
 * rather than by rendering alone.
 *
 * Why this file rides the RETURN-CONTEXT tier
 * (`playwright.return-context.config.ts`, the `return-context-api.mjs` double)
 * rather than the backend-free one: half of every row in the matrix is the
 * with-return-context arm, and `?returnTo=` is resolved on the SERVER before the
 * first byte of HTML — the backend-free tier can only ever observe the absent
 * context branch. The letter-sent and confirmed states likewise come from the
 * upstream's answers to the register and confirm commands, which this tier's
 * double gives for real. Only the network-failure case overrides the network,
 * and it overrides exactly one route.
 *
 * NOT in the matrix: `partnerLink` attribution (#1544). The clause's own
 * release-1 state list stops before it and the Issue defers the attribution arm
 * to wave 2 — a mobile-parity case for a slot that does not ship in release 1
 * would pin a surface that does not exist yet.
 *
 * TEST-ONLY slice. If a case fails against the unchanged surface the finding is
 * annotated and reported, never patched away and never weakened here.
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** The slug `e2e/support/return-context-api.mjs` answers for. */
const KNOWN_SLUG = "prp-pri-gonartroze";

const EMAIL = "doctor@clinic.ru";
const PASSWORD = "correct horse battery";

/** The composition statement the tier-1 consent label has to name (021 read model). */
const COMPOSITION = ["ФИО", "специальность", "город", "место работы"];

/** The copy the screen shows when the register command never reaches the upstream. */
const NETWORK_FAILURE_COPY =
  "Не удалось завершить регистрацию. Попробуйте ещё раз.";

/**
 * The canonical gate hand-off URL, built the way the producer builds it
 * (`apps/api/src/events/participation-cta.resolver.ts` -> `cta.href`).
 */
function arrival(slug: string): string {
  return `/register?${new URLSearchParams({ returnTo: `/webinars/${slug}` })}`;
}

/** Tick a consent through its label — the hit area of the checkbox primitive. */
async function tick(page: Page, testId: string) {
  await page.getByTestId(testId).locator("xpath=ancestor::label[1]").click();
  await expect(page.getByTestId(testId)).toBeChecked();
}

/**
 * The app's theme is class-based and persisted (`apps/doctor/lib/theme.ts`): the
 * FOUC guard reads `localStorage["ds-theme"]` before paint, so the ONLY way to
 * ask for a theme is to have that key present before the first navigation.
 * Playwright's `colorScheme` option is a no-op for this app, and `/register` is
 * chromeless — there is no toggle on the page to press.
 */
async function useTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript((value: string) => {
    window.localStorage.setItem("ds-theme", value);
  }, theme);
}

/** Fill the door with a valid submission, consents included. */
async function fillValid(page: Page) {
  await page.getByTestId("register-email").fill(EMAIL);
  await page.getByTestId("register-password").fill(PASSWORD);
  await tick(page, "register-medworker");
  await tick(page, "register-partner-data");
}

type StateSpec = {
  /** The release-1 state name, as EARS-16 lists it. */
  readonly name: string;
  /** Drive the route from a fresh `/register` load into the state. */
  readonly drive: (page: Page) => Promise<void>;
  /** The control that carries the state, asserted visible and operable. */
  readonly primary: "submit" | "verify" | "success";
  /**
   * Whether the submit is expected to be enabled. `null` where the submit is
   * not the state's control at all.
   */
  readonly submitEnabled: boolean | null;
  /** Whether the form composition (and hence the return-context slot) is on screen. */
  readonly formOnScreen: boolean;
};

const STATES: readonly StateSpec[] = [
  {
    name: "empty",
    drive: async () => {},
    primary: "submit",
    submitEnabled: false,
    formOnScreen: true,
  },
  {
    name: "filled-valid",
    drive: fillValid,
    primary: "submit",
    submitEnabled: true,
    formOnScreen: true,
  },
  {
    name: "field-errors",
    drive: async (page) => {
      await page.getByTestId("register-email").fill("not-an-address");
      await page.getByTestId("register-email").blur();
      await page.getByTestId("register-password").fill("short");
      await page.getByTestId("register-password").blur();
      await expect(page.locator('[aria-invalid="true"]').first()).toBeVisible();
    },
    primary: "submit",
    submitEnabled: false,
    formOnScreen: true,
  },
  {
    name: "network-failure",
    drive: async (page) => {
      // The ONE place this file overrides the double: the command has to fail
      // at the transport, which the upstream double has no way to express.
      await page.route("**/v1/storefront/doctor/register", (route) =>
        route.abort(),
      );
      await fillValid(page);
      await page.getByTestId("register-submit").click();
      await expect(page.getByText(NETWORK_FAILURE_COPY)).toBeVisible();
    },
    primary: "submit",
    // The form is still valid and the failure is retryable — a submit the
    // doctor cannot press again would be the defect, not the expectation.
    submitEnabled: true,
    formOnScreen: true,
  },
  {
    name: "letter-sent",
    drive: async (page) => {
      await fillValid(page);
      await page.getByTestId("register-submit").click();
      await expect(page.getByTestId("verify-submit")).toBeVisible();
    },
    primary: "verify",
    submitEnabled: null,
    formOnScreen: false,
  },
  {
    name: "confirmed",
    drive: async (page) => {
      await fillValid(page);
      await page.getByTestId("register-submit").click();
      await expect(page.getByTestId("verify-submit")).toBeVisible();
      // The slotted field auto-submits on completion (#175); the code itself is
      // checked by the 003 engine, which the double delegates to exactly as the
      // real command does.
      await page.locator('input[autocomplete="one-time-code"]').fill("ABC123");
      await expect(page.getByTestId("registration-success")).toBeVisible();
    },
    primary: "success",
    submitEnabled: null,
    formOnScreen: false,
  },
];

const VIEWPORTS = [
  { label: "390", width: 390, height: 844 },
  { label: "1440", width: 1440, height: 900 },
] as const;

const THEMES = ["light", "dark"] as const;

const ARRIVALS = [
  { label: "direct", url: "/register", gate: false },
  { label: "gate", url: arrival(KNOWN_SLUG), gate: true },
] as const;

/**
 * No horizontal overflow: the document itself does not scroll sideways, and the
 * screen's own box does not reach past the viewport's right edge. Both, because
 * a child that overflows a clipping ancestor leaves the document width intact
 * while still being unreachable.
 */
async function expectNoHorizontalOverflow(page: Page, width: number) {
  const measured = await page.evaluate(() => ({
    scrollWidth: document.scrollingElement?.scrollWidth ?? 0,
    innerWidth: window.innerWidth,
  }));
  expect(
    measured.scrollWidth,
    `document scrollWidth (${measured.scrollWidth}) exceeds the viewport (${measured.innerWidth})`,
  ).toBeLessThanOrEqual(measured.innerWidth);

  const box = await page.getByTestId("registration-screen").boundingBox();
  expect(box, "registration-screen has a box").not.toBeNull();
  expect(
    Math.round(box!.x + box!.width),
    "registration-screen reaches past the viewport's right edge",
  ).toBeLessThanOrEqual(width);
}

/** Operable, not merely painted: visible, and focusable from the keyboard. */
async function expectFocusable(
  locator: ReturnType<Page["locator"]>,
  label: string,
) {
  await expect(locator, `${label} is visible`).toBeVisible();
  await locator.focus();
  await expect(locator, `${label} takes focus`).toBeFocused();
}

async function expectAxeClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => node.target).flat(),
  }));
  expect(summary, `axe violations on /register (${label})`).toEqual([]);
}

/**
 * The parity matrix: 48 cases, one `test()` each. Numbering is flat across the
 * clause (ADR-0006 §4) and deterministic in the loop order below, so a case
 * keeps its number as long as the matrix keeps its shape.
 */
let caseNumber = 0;

for (const viewport of VIEWPORTS) {
  for (const theme of THEMES) {
    test.describe(`021 EARS-16: ${viewport.label} x ${theme}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      for (const arrivalCase of ARRIVALS) {
        for (const state of STATES) {
          caseNumber += 1;
          const label = `${viewport.label} / ${theme} / ${arrivalCase.label} / ${state.name}`;

          test(`021 EARS-16.${caseNumber}: ${label} — intended theme, no horizontal overflow, an operable control and no axe violation`, async ({
            page,
          }) => {
            await useTheme(page, theme);
            await page.goto(arrivalCase.url);

            // (a) the theme actually painted is the one asked for — every
            // contrast assertion below is worthless if it is not.
            const html = page.locator("html");
            if (theme === "dark") {
              await expect(html, "html carries the dark class").toHaveClass(
                /(^|\s)dark(\s|$)/,
              );
            } else {
              await expect(html, "html has no dark class").not.toHaveClass(
                /(^|\s)dark(\s|$)/,
              );
            }

            await state.drive(page);

            // (b) nothing is pushed off the side at either width.
            await expectNoHorizontalOverflow(page, viewport.width);

            // (c) the state's own control is visible and operable.
            if (state.primary === "submit") {
              const submit = page.getByTestId("register-submit");
              await expect(submit, "the submit is visible").toBeVisible();
              if (state.submitEnabled) {
                await expect(submit, "the submit is enabled").toBeEnabled();
                await expectFocusable(submit, "the submit");
              } else {
                await expect(submit, "the submit is disabled").toBeDisabled();
                // EARS-12: a disabled control that does not say why is a dead
                // button. Presence is asserted here; the announcement contract
                // itself is 16.51.
                const describedBy =
                  await submit.getAttribute("aria-describedby");
                expect(
                  describedBy,
                  "the disabled submit points at a reason",
                ).toBeTruthy();
              }
            } else if (state.primary === "verify") {
              await expect(
                page.getByTestId("verify-submit"),
                "the confirm action is visible",
              ).toBeVisible();
              await expectFocusable(
                page.locator('input[autocomplete="one-time-code"]').first(),
                "the code field",
              );
            } else {
              await expect(
                page.getByTestId("registration-success"),
                "the success screen is visible",
              ).toBeVisible();
              await expectFocusable(
                page.getByTestId("registration-success-primary"),
                "the success primary action",
              );
            }

            // The gate arm's own promise: the context the doctor arrived with
            // is on screen at BOTH widths — the split's left panel at 1440, the
            // plate above the form at 390 — and at 390 it sits inside the
            // viewport rather than being clipped by it.
            if (arrivalCase.gate && state.formOnScreen) {
              const card =
                viewport.width < 768
                  ? page.getByTestId("return-context-plate")
                  : page.getByTestId("return-context-panel");
              await expect(card, "the return context is visible").toBeVisible();
              const cardBox = await card.boundingBox();
              expect(cardBox, "the return context has a box").not.toBeNull();
              expect(
                Math.round(cardBox!.x + cardBox!.width),
                "the return context is clipped by the viewport",
              ).toBeLessThanOrEqual(viewport.width);
            }

            // (d) the WCAG 2 A/AA bar, in THIS theme at THIS width. The dark
            // arm is what nothing else on main covers.
            await expectAxeClean(page, label);
          });
        }
      }
    });
  }
}

/**
 * The four accessibility contracts of the route. They are properties of the
 * MARKUP, not of the viewport or the theme, so running them 48 times would buy
 * nothing but wall time — they run once, at the narrow width in the light
 * theme, where the composition is densest.
 */
test.describe("021 EARS-16: the accessibility contracts of the route", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("021 EARS-16.49: every consent is a labelled control in the accessibility tree", async ({
    page,
  }) => {
    await page.goto("/register");

    // Three checkboxes, each carrying a name — the property that makes them
    // usable by voice control and by a screen reader's forms list.
    const checkboxes = page.getByRole("checkbox");
    await expect(checkboxes).toHaveCount(3);

    const names = await checkboxes.evaluateAll((nodes) =>
      nodes.map((node) => {
        const label = node.closest("label");
        return (label?.textContent ?? "").replace(/\s+/g, " ").trim();
      }),
    );
    for (const name of names) {
      expect(name, "a checkbox with an empty accessible name").not.toBe("");
    }

    // The tier-1 pair carries the composition statement: the doctor is told
    // WHAT is shared, in the label of the control that shares it.
    const partnerName = await page
      .getByTestId("register-partner-data")
      .locator("xpath=ancestor::label[1]")
      .innerText();
    for (const part of COMPOSITION) {
      expect(partnerName, `the partner-data label names "${part}"`).toContain(
        part,
      );
    }
  });

  test("021 EARS-16.50: every field error is programmatically associated with its field", async ({
    page,
  }) => {
    await page.goto("/register");

    await page.getByTestId("register-email").fill("not-an-address");
    await page.getByTestId("register-email").blur();
    await page.getByTestId("register-password").fill("short");
    await page.getByTestId("register-password").blur();

    for (const testId of ["register-email", "register-password"]) {
      const field = page.getByTestId(testId);
      await expect(field, `${testId} is marked invalid`).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      const describedBy = await field.getAttribute("aria-describedby");
      expect(describedBy, `${testId} points at its message`).toBeTruthy();

      // The pointer RESOLVES, and what it resolves to is the message the eye
      // sees — an id that dangles is the same as no message at all.
      const ids = describedBy!.split(/\s+/).filter(Boolean);
      const texts: string[] = [];
      for (const id of ids) {
        const target = page.locator(`[id="${id}"]`);
        if ((await target.count()) === 0) continue;
        texts.push((await target.first().innerText()).trim());
      }
      expect(
        texts.some((text) => text.length > 0),
        `${testId}'s aria-describedby resolves to visible message text`,
      ).toBe(true);
    }
  });

  test("021 EARS-16.51: the disabled submit announces its reason, and a complete form enables it", async ({
    page,
  }) => {
    await page.goto("/register");

    const submit = page.getByTestId("register-submit");
    await expect(submit).toBeDisabled();

    const describedBy = await submit.getAttribute("aria-describedby");
    expect(describedBy, "the disabled submit points at a reason").toBeTruthy();
    const reason = page.locator(`[id="${describedBy!.split(/\s+/)[0]}"]`);
    await expect(
      reason,
      "the reason element exists and is visible",
    ).toBeVisible();
    await expect(reason, "the reason is not empty").not.toHaveText(/^\s*$/);

    await fillValid(page);
    await expect(
      submit,
      "a complete, valid, consented form enables the submit",
    ).toBeEnabled();
  });

  test("021 EARS-16.52: the two consent tiers are separated in the accessibility tree, not by rendering alone", async ({
    page,
  }) => {
    await page.goto("/register");

    // Tier 1 is a NAMED group — the frame the eye sees IS the element that is
    // announced to assistive technology, not a second wrapper inside it.
    const group = page.getByTestId("registration-consent-access");
    await expect(group, "the access tier exists once").toHaveCount(1);
    await expect(group, "the access tier is a group").toHaveAttribute(
      "role",
      "group",
    );
    const groupName = await group.evaluate((node) => {
      const labelledBy = node.getAttribute("aria-labelledby");
      if (labelledBy) {
        return labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
      }
      return (node.getAttribute("aria-label") ?? "").trim();
    });
    expect(groupName, "the access group has an accessible name").not.toBe("");

    // Both access conditions are inside it…
    await expect(group.getByTestId("register-medworker")).toHaveCount(1);
    await expect(group.getByTestId("register-partner-data")).toHaveCount(1);
    // …and the optional opt-in is not: the separation is structural.
    await expect(
      group.getByTestId("register-marketing"),
      "the marketing opt-in is outside the access group",
    ).toHaveCount(0);
    await expect(
      page.getByTestId("registration-consent-marketing"),
      "the optional tier stands on its own",
    ).toHaveCount(1);
  });
});
