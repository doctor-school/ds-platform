import { expect, test } from "@playwright/test";
import { signInAsAdmin } from "@ds/e2e/admin-events";
import { standHttpCredentials } from "@ds/e2e/stand-http-credentials";
import { isGoldenUuid } from "../../../packages/db/src/seed/golden/ids";
import { visible } from "./support/visible";

// The stage reports are published. Keep sign-in and MFA out of the captures.
test.use({ trace: "off", screenshot: "off", video: "off" });

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`Stage feed visibility requires ${name}`);
  return value;
}

test("Staff hides and restores a Telegram post on the Academy home feed", async ({
  page: admin,
  browser,
}) => {
  test.setTimeout(240_000);
  const home = new URL("/", required("E2E_PORTAL_URL")).href;
  const credentials = {
    email: required("E2E_STAGE_ADMIN_EMAIL"),
    password: required("DS_STAGE_AGENT_ADMIN_PASSWORD"),
    totpSecret: required("DS_STAGE_AGENT_ADMIN_TOTP_SECRET"),
  };
  const visitor = await browser.newContext({
    locale: "ru-RU",
    httpCredentials: standHttpCredentials(),
  });
  try {
    const academy = await visitor.newPage();
    const rail = academy
      .locator('[data-academy-section="feed"]')
      .getByRole("region");
    // Match the golden channels, and verify the selected row's seed identity
    // before making any change on a slot that also has a connected bot.
    const goldenCards = rail.locator('a[href^="https://t.me/bbm_academy_"]');
    await academy.goto(home, { waitUntil: "domcontentloaded" });
    await expect(goldenCards.nth(1)).toBeVisible();
    const href = (await goldenCards.first().getAttribute("href"))!;
    const otherHref = (await goldenCards.nth(1).getAttribute("href"))!;
    const channel = new URL(href).pathname.split("/")[1];
    const card = rail.locator(`a[href="${href}"]`);
    const otherCard = rail.locator(`a[href="${otherHref}"]`);
    await expect(card).toBeVisible();

    await signInAsAdmin(admin, credentials);
    await admin.goto("/materials/sources");
    await visible(admin.getByTestId(`feed-source-posts-${channel}`)).click();
    await expect(
      admin.getByRole("heading", {
        level: 1,
        name: `Публикации · t.me/${channel}`,
      }),
    ).toBeVisible();
    const original = visible(
      admin.locator(`a[data-testid^="feed-post-original-"][href="${href}"]`),
    );
    await expect(original).toBeVisible();
    const id = (await original.getAttribute("data-testid"))!.slice(
      "feed-post-original-".length,
    );
    expect(isGoldenUuid(id), "the post must belong to the golden seed").toBe(
      true,
    );
    const state = visible(admin.getByTestId(`feed-post-state-${id}`));
    const hide = visible(admin.getByTestId(`feed-post-hide-${id}`));
    const restore = visible(admin.getByTestId(`feed-post-unhide-${id}`));
    await expect(state).toHaveText("В ленте");

    let restored = false;
    try {
      await test.step("Hide the post and check a fresh Academy home read", async () => {
        await hide.click();
        await admin.getByTestId("feed-post-hide-confirm").click();
        await expect(state).toHaveText("Скрыт");
        await academy.reload({ waitUntil: "domcontentloaded" });
        // A second unchanged card proves that the new feed has loaded.
        await expect(otherCard).toBeVisible();
        await expect(card).toHaveCount(0);
      });

      await test.step("Restore the post and see it on the Academy home again", async () => {
        await restore.click();
        await expect(state).toHaveText("В ленте");
        restored = true;
        await academy.reload({ waitUntil: "domcontentloaded" });
        await expect(card).toBeVisible();
      });
    } finally {
      if (!restored) {
        await admin.reload({ waitUntil: "domcontentloaded" });
        await expect(state).toBeVisible();
        if (await restore.isVisible()) await restore.click();
        await expect(state).toHaveText("В ленте");
      }
    }
  } finally {
    await visitor.close();
  }
});
