import { expect, type Page } from "@playwright/test";
import { bootstrapDoctorSession } from "@ds/e2e/admin-events";
import { seedStorefrontSession } from "@ds/e2e/storefront-session-seed";

import { verifyEmailAtIdp } from "./staff-access";

/**
 * A doctor holding a live STOREFRONT session in `page`'s browser context, on
 * the admin origin (#3565). The admin tier runs no storefront and no sign-in
 * host app, so the session is minted the production way through the sign-in
 * host's API (`seedStorefrontSession`, `@ds/e2e/storefront-session-seed`) and
 * the cookie is put into the context. The account is a CONFIRMED one: the
 * platform registration, then its mailbox proven by an IdP-issued code
 * returned to the IdP (`verifyEmailAtIdp`) — the admin tier has no mail sink.
 *
 * `page` must already be on the admin origin (the session's fingerprint is
 * read from the request that put it there). Before returning, the session is
 * proven live by a storefront read through the admin origin's `/v1/*` proxy,
 * so a seeded cookie the API would not honour cannot pass for one.
 */
export async function signInDoctorOnAdminOrigin(
  page: Page,
  prefix: string,
): Promise<{ email: string; cookieName: string }> {
  const origin = new URL(page.url()).origin;
  const { email, password } = await bootstrapDoctorSession(origin, prefix);
  await verifyEmailAtIdp(email);

  const sent = page.waitForRequest(
    (request) =>
      request.isNavigationRequest() && request.url().startsWith(origin),
  );
  await page.reload();
  const headers = await (await sent).allHeaders();
  const cookie = await seedStorefrontSession({
    email,
    password,
    fingerprint: {
      userAgent: headers["user-agent"] ?? "",
      acceptLanguage: headers["accept-language"] ?? "",
    },
  });

  await page.context().addCookies([
    {
      name: cookie.name,
      value: cookie.value,
      domain: new URL(origin).hostname,
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const profile = await page.evaluate(async () => {
    const res = await fetch("/v1/me/profile", {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    return res.status;
  });
  expect(profile, `the storefront session of ${email} must be live`).toBe(200);
  return { email, cookieName: cookie.name };
}
