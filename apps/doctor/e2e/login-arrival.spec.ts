import { test, expect, type BrowserContext } from "@playwright/test";

/**
 * #1955 — the two `/login` behaviours that are decided on the SERVER, against a
 * real upstream, and are therefore invisible to the backend-free tier.
 *
 * Both need an api: the return context is resolved before the first byte of
 * HTML (021 EARS-2), and so is the session status the door now branches on
 * (`@ds/auth-flow/server`). Neither read passes through the browser, so neither can
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
// #3172 — the door's return-context copy (#1955 rows 1-2) renders on the
// sign-in host from the entry intent: `apps/login/e2e/doctor-login-arrival.e2e.spec.ts`.
// The signed-in redirect is still THIS storefront entry's decision.

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
  // (`@ds/auth-flow/server` `resolveDirectArrivalLanding`) — never `/account`,
  // and never the door.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("password-login-form")).toHaveCount(0);
});

test("017 #1955: a guest still gets the door — the guard closes it to nobody else", async ({
  page,
}) => {
  // A guest's entry hands over to the sign-in host (#3172): a 303 to the
  // authorize URL (this tier's double answers it); the form there is proven
  // on the sign-in host tier (`apps/login/e2e/doctor-login.e2e.spec.ts`).
  const entry = page.waitForResponse(
    (res) => new URL(res.url()).pathname === "/login",
  );
  await page.goto("/login");

  expect((await entry).status()).toBe(303);
  await expect(page).toHaveURL(/\/oauth\/v2\/authorize\?.*state=tx-\d+/);
});
