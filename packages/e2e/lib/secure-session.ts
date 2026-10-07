import { expect, type Page, type Response } from "@playwright/test";

const SESSION = "__Host-ds_session";

/** Shared browser-cookie and readable-store proof for owned auth journeys. */
export async function assertSecureSession(
  page: Page,
  response: Response,
  base: string,
  priorCookies: string[] = [],
): Promise<void> {
  const header = (await response.headerValue("set-cookie")) ?? "";
  expect(
    header.includes(`${SESSION}=`),
    "authentication minted session cookie",
  ).toBe(true);
  expect(/(?:^|;)\s*Domain=/i.test(header), "no Domain attribute").toBe(false);
  const session = (await page.context().cookies()).find(
    (cookie) => cookie.name === SESSION,
  );
  expect(Boolean(session), "fresh session exists").toBe(true);
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
