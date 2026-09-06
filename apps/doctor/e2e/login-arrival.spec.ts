import { test, expect, type BrowserContext } from "@playwright/test";

/**
 * #1955 — the two `/login` behaviours that are decided on the SERVER, against a
 * real upstream, and are therefore invisible to the backend-free tier.
 *
 * Both need an api: the return context is resolved before the first byte of
 * HTML (021 EARS-2), and so is the session status the door now branches on
 * (`lib/shell-auth.ts`). Neither read passes through the browser, so neither can
 * be intercepted with `page.route` — the spec rides the register-arrival tier,
 * which boots the app against `e2e/support/return-context-api.mjs` with
 * `API_PROXY_TARGET` pointing at it, exactly the way production addresses the
 * api.
 *
 * The event is the double's own, `prp-pri-gonartroze` — the canvas's return
 * context, the same one `register-return-context.spec.ts` drives, so the two
 * doors are compared against one fixture rather than two.
 */
const GATE_ARRIVAL = "/login?returnTo=%2Fwebinars%2Fprp-pri-gonartroze";
const EVENT_TITLE = "PRP при гонартрозе";

/** The login door's own assurance line — sign-in returns the doctor on the spot. */
const LOGIN_ASSURANCE = "После входа вы вернётесь сюда же — место за вами.";
/** The registration door's line — it must NOT appear on the sign-in door. */
const REGISTER_ASSURANCE = "После подтверждения почты вы вернётесь сюда же";

/**
 * Put the double's live session on the doctor origin. `__Host-` requires
 * `secure` + path `/` + no domain; Chromium accepts a secure cookie on
 * `localhost`, which is why this tier's base URL is `localhost` and not an IP.
 */
async function signIn(context: BrowserContext, baseURL: string): Promise<void> {
  const origin = new URL(baseURL);
  await context.addCookies([
    {
      name: "__Host-ds_session",
      value: "e2e-signed-in-doctor",
      domain: origin.hostname,
      path: "/",
      secure: true,
      httpOnly: true,
    },
  ]);
}

test("021 #1955: the sign-in door promises the return happens on SIGN-IN, not after an email", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(GATE_ARRIVAL);

  const panel = page.getByTestId("return-context-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator("[data-webinar-card]")).toContainText(EVENT_TITLE);

  // The whole point of the fix: the shared panel now states the step THIS door
  // actually takes. Telling a doctor who already has an account to wait for a
  // confirmation letter sends them looking for mail that is never sent.
  await expect(panel).toContainText(LOGIN_ASSURANCE);
  await expect(panel).not.toContainText(REGISTER_ASSURANCE);
});

test("021 #1955: the registration door beside it keeps its own confirmation wording", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/register?returnTo=%2Fwebinars%2Fprp-pri-gonartroze");

  const panel = page.getByTestId("return-context-panel");
  await expect(panel).toContainText(REGISTER_ASSURANCE);
  await expect(panel).not.toContainText(LOGIN_ASSURANCE);
});

test("017 #1955: a signed-in doctor arriving at /login is returned to the эфир they came from", async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!);
  await page.goto(GATE_ARRIVAL);

  // The redirect is server-side, so the form is never painted at all — the
  // assertion is on the landed URL, not on a form that disappears.
  // This host's own projection of the gate target (#1945), not the academy path
  // the guard reconstructed.
  await expect(page).toHaveURL(/\/events\/prp-pri-gonartroze$/);
  await expect(page.getByTestId("password-login-form")).toHaveCount(0);
});

test("017 #1955: a signed-in doctor arriving at /login directly lands on the LD-4 destination", async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!);
  await page.goto("/login");

  // No remembered specialty on this context ⇒ the storefront home, per LD-4
  // (`lib/registration-landing.ts`) — never `/account`, and never the door.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("password-login-form")).toHaveCount(0);
});

test("017 #1955: a guest still gets the door — the guard closes it to nobody else", async ({
  page,
}) => {
  await page.goto("/login");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByTestId("password-login-form")).toBeVisible();
});
