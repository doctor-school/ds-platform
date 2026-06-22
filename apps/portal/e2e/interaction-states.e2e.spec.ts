import { test, expect, type Locator } from "@playwright/test";

/**
 * Interaction-state runtime smoke (ADR-0013 §7 layer 4, #274).
 *
 * Layer 3 (`interaction-states` lint, #269) is a STATIC scan: it proves a hover /
 * focus-visible class STRING is present in the primitive source. This spec is the
 * RUNTIME twin — it drives the real rendered controls on the auth surfaces and
 * asserts the states actually BEHAVE: the enabled control shows `cursor: pointer`
 * and a disabled one `not-allowed` (the layer-1 base-reset, §7.1), a real `hover`
 * produces a measurable style delta (§7.2 hover affordance), and REAL keyboard
 * focus paints a visible focus-visible ring (§7.2 — driven via `Tab`, never
 * programmatic `.focus()`, because `:focus-visible` only matches keyboard focus).
 *
 * Backend-free: every control under test renders client-side on `/login`, so no
 * api / Zitadel / Mailpit is touched (no submit is ever performed). Selectors are
 * locale-agnostic (`data-testid` / role) so the RU copy does not break them. We
 * read COMPUTED styles only — never class strings — because Turbopack/Next mangle
 * class names and computed style is the only ground truth (memory
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

test.describe("#274 interaction-state runtime smoke (backend-free)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    // The login Tabs default to the password method; wait for the primary submit
    // (a real <button>) to be present before probing styles.
    await expect(page.getByTestId("password-login-submit")).toBeVisible();
  });

  test("primary submit Button: cursor pointer enabled, not-allowed disabled", async ({
    page,
  }) => {
    const submit = page.getByTestId("password-login-submit");
    await expect(submit).toBeEnabled();

    // Enabled → pointer (layer-1 base-reset restores the v4-Preflight-dropped
    // `button { cursor: pointer }`).
    expect(await cssProp(submit, "cursor")).toBe("pointer");

    // Disabled → not-allowed. We flip the REAL rendered button's `disabled`
    // attribute (the same state the app sets while `isSubmitting`) and read the
    // computed cursor: this verifies the global stylesheet's
    // `:disabled { cursor: not-allowed }` rule resolves against a live element —
    // we are exercising the shipped CSS contract, not patching app source.
    await submit.evaluate((el) =>
      (el as HTMLButtonElement).setAttribute("disabled", ""),
    );
    expect(await cssProp(submit, "cursor")).toBe("not-allowed");
  });

  test("Tabs trigger: measurable hover background delta", async ({ page }) => {
    // The INACTIVE login-method tab carries a `hover:bg-background/50` affordance;
    // hovering it must change the computed background-color. Probe the inactive
    // ("otp") trigger so the active-state styling does not mask the delta.
    const otpTab = page.getByTestId("login-method-otp");
    await expect(otpTab).toHaveAttribute("data-state", "inactive");

    // Park the pointer elsewhere first so the trigger starts un-hovered.
    await page.mouse.move(0, 0);
    const before = await cssProp(otpTab, "background-color");
    await otpTab.hover();
    // Wait for the colour transition to settle, then read again.
    await expect
      .poll(async () => cssProp(otpTab, "background-color"))
      .not.toBe(before);
  });

  test("primary submit Button: measurable hover background delta", async ({
    page,
  }) => {
    const submit = page.getByTestId("password-login-submit");
    await page.mouse.move(0, 0);
    const before = await cssProp(submit, "background-color");
    await submit.hover();
    // `default` variant: `hover:bg-primary/90` — the fill must shift on hover.
    await expect
      .poll(async () => cssProp(submit, "background-color"))
      .not.toBe(before);
  });

  test("keyboard focus paints a visible focus-visible ring", async ({
    page,
  }) => {
    // Drive REAL keyboard focus: `:focus-visible` (the ring trigger) only matches
    // keyboard focus, never `.focus()`. Tab from the page body until the password
    // tab trigger (the first focusable interactive control in the card) is the
    // active element, then capture its ring signature.
    const passwordTab = page.getByTestId("login-method-password");
    const unfocused = await focusSignature(passwordTab);

    // Tab through the document until the password tab is focused. The login-method
    // TabsList is at the top of the card, so a bounded loop reaches it quickly.
    let focused = false;
    for (let i = 0; i < 12 && !focused; i++) {
      await page.keyboard.press("Tab");
      focused = await passwordTab.evaluate((el) => el === document.activeElement);
    }
    expect(focused).toBe(true);

    // The focus-visible ring (box-shadow ring and/or outline) must differ from the
    // un-focused signature — a visible keyboard-focus affordance.
    const focusedSig = await focusSignature(passwordTab);
    expect(focusedSig).not.toBe(unfocused);
  });
});
