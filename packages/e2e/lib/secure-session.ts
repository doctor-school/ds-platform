import { expect, type Page, type Response } from "@playwright/test";

const SESSION = "__Host-ds_session";

/**
 * Shared browser-cookie and readable-store proof for owned auth journeys.
 *
 * Since ADR-0015 §4 (#3172) the credential command (`response`) is answered by
 * the SIGN-IN HOST, which never mints the storefront session: the storefront's
 * own `/auth/callback` relays `__Host-ds_session` on the way back, before its
 * final redirect. So the command must set NO storefront session cookie, and the
 * minted session is proven where it now lands — the storefront's cookie jar:
 * present, fresh (not one of `priorCookies`), host-only (a `Domain` attribute
 * would surface as a dotted domain), `Path=/`, `HttpOnly`, `Secure`, `Lax`.
 */
export async function assertSecureSession(
  page: Page,
  response: Response,
  base: string,
  priorCookies: string[] = [],
): Promise<void> {
  const header = (await response.headerValue("set-cookie")) ?? "";
  if (new URL(response.url()).origin === new URL(base).origin) {
    // A storefront's own command (session refresh) still mints in place.
    expect(
      header.includes(`${SESSION}=`),
      "authentication minted session cookie",
    ).toBe(true);
    expect(/(?:^|;)\s*Domain=/i.test(header), "no Domain attribute").toBe(
      false,
    );
  } else {
    expect(
      header.includes(`${SESSION}=`),
      "the sign-in host's command mints no storefront session",
    ).toBe(false);
  }
  const session = (await page.context().cookies()).find(
    (cookie) => cookie.name === SESSION,
  );
  expect(
    Boolean(session),
    "authentication minted session cookie (relayed by the storefront callback)",
  ).toBe(true);
  expect({
    domain: session!.domain,
    path: session!.path,
    httpOnly: session!.httpOnly,
    secure: session!.secure,
    sameSite: session!.sameSite,
  }).toEqual({
    domain: new URL(base).hostname,
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  });
  expect(
    priorCookies.includes(session!.value),
    "fresh session differs from prior sessions",
  ).toBe(false);
  const exposed = await page.evaluate(() => {
    const readable = JSON.stringify({
      url: location.href,
      cookie: document.cookie,
      local: Object.entries(localStorage),
      session: Object.entries(sessionStorage),
    });
    return /__Host-ds_session|access[_-]?token|refresh[_-]?token|eyJ[\w-]+\.[\w-]+\.[\w-]+/i.test(
      readable,
    );
  });
  expect(
    exposed,
    "no tokens or private session in JavaScript-readable stores",
  ).toBe(false);
}
