import { test, expect, type Page } from "@playwright/test";

import { authRequestId, type Door } from "./support/sign-in-door";

/**
 * 003 EARS-71 (door stability, lead decision) — Zitadel lands every auth
 * request on the host's `/login`, where the entry chose the door. The rendered
 * door settles the address on its own path (same auth request, no new history
 * entry), so a reload, Back or Forward re-enters THAT door by its path once the
 * one-shot intent is spent. The tier's entry double answers the door per auth
 * request id (`support/sign-in-entry-api.mjs`).
 */
const DOOR_MARK: Record<Exclude<Door, "login">, string> = {
  register: "registration-form",
  reset: "reset-request-submit",
};

async function expectDoor(page: Page, door: Exclude<Door, "login">) {
  await expect(page.getByTestId(DOOR_MARK[door])).toBeVisible();
}

for (const door of ["register", "reset"] as const) {
  test(`003 EARS-71: the IdP's /login arrival on the ${door} door settles on /${door} and survives reload, Back and Forward`, async ({
    page,
  }) => {
    const id = authRequestId("academy", door);
    await page.goto("about:blank");
    await page.goto(`/login?authRequest=${id}`);
    await expectDoor(page, door);
    await page.waitForURL((url) => url.pathname === `/${door}`);
    const settled = new URL(page.url());
    expect(settled.search).toBe(`?authRequest=${id}`);
    expect(await page.evaluate(() => window.history.length)).toBe(2);

    await page.reload({ waitUntil: "load" });
    expect(new URL(page.url()).pathname).toBe(`/${door}`);
    await expectDoor(page, door);

    await page.goBack();
    await expect.poll(() => page.url()).toBe("about:blank");
    await page.goForward();
    await expectDoor(page, door);
    expect(page.url()).toBe(settled.toString());
  });
}
