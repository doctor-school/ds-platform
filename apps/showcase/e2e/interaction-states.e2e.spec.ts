import { test, expect, type Locator } from "@playwright/test";

/**
 * Interaction-state runtime smoke, RETARGETED onto the showcase (ADR-0013 §7
 * layer 4; design-system-showcase spec §5.2, #351).
 *
 * Layer 3 (`interaction-states` lint, #269) is a STATIC scan: it proves a hover /
 * focus-visible class STRING is present in a primitive's source. This spec is the
 * RUNTIME twin — it drives the REAL rendered `@ds/design-system` primitives and
 * asserts the states actually BEHAVE. It used to run against the auth surfaces
 * (`apps/portal`, #274); the §5.2 retarget moves it onto the showcase, which
 * renders every primitive in every state in one place — so the same three
 * §7.1/§7.2 contract behaviours are now asserted against the design system's own
 * catalogue, not one consumer:
 *   - an enabled control shows `cursor: pointer` and a disabled one `not-allowed`
 *     (the layer-1 base-reset, §7.1);
 *   - a real `hover` produces a measurable style delta (§7.2 hover affordance);
 *   - REAL keyboard focus paints a visible focus-visible ring (§7.2 — driven via
 *     `Tab`, never programmatic `.focus()`, because `:focus-visible` only matches
 *     keyboard focus).
 *
 * Backend-free: the showcase is a pure viewer with no BFF, so the catalogue
 * renders entirely client-side and nothing here is ever submitted. Selectors are
 * the primitives' accessible role + name (the showcase is English-only, no i18n);
 * we read COMPUTED styles only — never class strings — because Turbopack/Next
 * mangle class names and computed style is the only ground truth (memory
 * `reference_cdp_forced_pseudo_state_isolation`); and we drive REAL Playwright
 * `hover()` / keyboard `Tab`, not CDP `forcePseudoState` (which leaks across
 * sessions).
 */

/** Computed value of a single CSS property on a locator. */
async function cssProp(locator: Locator, prop: string): Promise<string> {
  return locator.evaluate(
    (el, p) => getComputedStyle(el as Element).getPropertyValue(p),
    prop,
  );
}

/**
 * A focus-ring "signature": the box-shadow + outline a focus-visible ring paints.
 * The `interactiveBase` fragment renders the ring as a `ring-2` (a box-shadow)
 * with a `ring-offset`; some primitives also draw an `outline`. Capturing both
 * makes the assertion robust to which mechanism a given primitive uses.
 */
async function focusSignature(locator: Locator): Promise<string> {
  return locator.evaluate((el) => {
    const s = getComputedStyle(el as Element);
    return `${s.boxShadow}|${s.outlineStyle}|${s.outlineWidth}|${s.outlineColor}`;
  });
}

test.describe("#351 interaction-state runtime smoke on the showcase (backend-free)", () => {
  test.beforeEach(async ({ page }) => {
    // /primitives renders every primitive across its states; the Button section's
    // "Live sample" control is the representative enabled control under test.
    await page.goto("/primitives");
    await expect(
      page.getByRole("button", { name: "Click me", exact: true }),
    ).toBeVisible();
  });

  test("Button: cursor pointer enabled, not-allowed disabled", async ({
    page,
  }) => {
    const button = page.getByRole("button", { name: "Click me", exact: true });
    await expect(button).toBeEnabled();

    // Enabled → pointer (layer-1 base-reset restores the v4-Preflight-dropped
    // `button { cursor: pointer }`).
    expect(await cssProp(button, "cursor")).toBe("pointer");

    // Disabled → not-allowed. Flip the REAL rendered button's `disabled`
    // attribute (the same state an app sets while submitting) and read the
    // computed cursor: this verifies the global stylesheet's
    // `:disabled { cursor: not-allowed }` rule resolves against a live element —
    // exercising the shipped CSS contract, not patching showcase source.
    await button.evaluate((el) =>
      (el as HTMLButtonElement).setAttribute("disabled", ""),
    );
    expect(await cssProp(button, "cursor")).toBe("not-allowed");
  });

  test("Button: measurable hover background delta", async ({ page }) => {
    const button = page.getByRole("button", { name: "Click me", exact: true });
    // Park the pointer elsewhere first so the control starts un-hovered.
    await page.mouse.move(0, 0);
    const before = await cssProp(button, "background-color");
    await button.hover();
    // `default` variant: `hover:bg-primary/90` — the fill must shift on hover.
    await expect
      .poll(async () => cssProp(button, "background-color"))
      .not.toBe(before);
  });

  test("keyboard focus paints a visible focus-visible ring", async ({
    page,
  }) => {
    // The section back-link ("← Showcase home") is the real `Link` primitive and
    // the first focusable control on the page, so a single `Tab` from the body
    // reaches it. Drive REAL keyboard focus: `:focus-visible` (the ring trigger)
    // only matches keyboard focus, never `.focus()`.
    const backLink = page.getByRole("link", { name: /Showcase home/ });
    const unfocused = await focusSignature(backLink);

    await page.keyboard.press("Tab");
    const focused = await backLink.evaluate(
      (el) => el === document.activeElement,
    );
    expect(focused).toBe(true);

    // The focus-visible ring (box-shadow ring and/or outline) must differ from the
    // un-focused signature — a visible keyboard-focus affordance.
    const focusedSig = await focusSignature(backLink);
    expect(focusedSig).not.toBe(unfocused);
  });
});
