import { AUTH_FLOW_PAGE_TITLES } from "@ds/auth-flow/copy";
import { test, expect, type Page } from "@playwright/test";

import { authRequestId, doorPath, type Door } from "./support/sign-in-door";

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
    // The tab names the door rendered, as the storefront's own page did —
    // never the sign-in title of the `/login` address it arrived on.
    await expect(page).toHaveTitle(AUTH_FLOW_PAGE_TITLES[door]);
    await page.waitForURL((url) => url.pathname === `/${door}`);
    const settled = new URL(page.url());
    expect(settled.search).toBe(`?authRequest=${id}`);
    expect(await page.evaluate(() => window.history.length)).toBe(2);

    await page.reload({ waitUntil: "load" });
    expect(new URL(page.url()).pathname).toBe(`/${door}`);
    await expectDoor(page, door);
    await expect(page).toHaveTitle(AUTH_FLOW_PAGE_TITLES[door]);

    await page.goBack();
    await expect.poll(() => page.url()).toBe("about:blank");
    await page.goForward();
    await expectDoor(page, door);
    expect(page.url()).toBe(settled.toString());
  });
}

/**
 * 003 EARS-71 — each door of the sign-in host carries the storefront's own
 * tab title for that door (`AUTH_FLOW_PAGE_TITLES`, the storefront pages'
 * metadata): a direct door address, and a hop that renders another door.
 */
test("003 EARS-71: every host door carries the storefront's title for that door, a hop included", async ({
  page,
}) => {
  for (const door of ["login", "register", "reset"] as const) {
    await page.goto(doorPath("doctor", door));
    await expect(page).toHaveTitle(AUTH_FLOW_PAGE_TITLES[door]);
  }
  await page.goto(
    doorPath("doctor", "register", {}, "verify") + "&email=doctor%40clinic.ru",
  );
  await expect(page.getByTestId("verify-card")).toBeVisible();
  await expect(page).toHaveTitle(AUTH_FLOW_PAGE_TITLES.verify);

  await page.goto(doorPath("doctor", "login"));
  await page.getByRole("link", { name: "Создать аккаунт" }).click();
  await expect(page.getByTestId("registration-form")).toBeVisible();
  await expect(page).toHaveTitle(AUTH_FLOW_PAGE_TITLES.register);
});
