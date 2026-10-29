import { ENTRY_REFUSAL_COPY } from "@ds/auth-flow/copy";
import { expect, test } from "@playwright/test";

/**
 * 003 EARS-72 — an entry the API refuses renders the sign-in site's refusal
 * page at the truthful status: the tier's entry double answers 429 (with and
 * without `Retry-After`) or 503 for the named auth requests
 * (`support/sign-in-entry-api.mjs`).
 */
const TITLES = {
  "rate-limited": ENTRY_REFUSAL_COPY.variants["rate-limited"].map((v) => v.title),
  unavailable: ENTRY_REFUSAL_COPY.variants.unavailable.map((v) => v.title),
};

test("003 EARS-72: a rate-limited entry is a 429 refusal page counting down the API's wait on the disabled retry", async ({
  page,
}) => {
  const res = await page.goto("/login?authRequest=REFUSE_429");
  expect(res?.status()).toBe(429);
  expect(res?.headers()["retry-after"]).toBe("105");
  const heading = await page.getByRole("heading", { level: 1 }).textContent();
  expect(TITLES["rate-limited"]).toContain(heading);
  const retry = page.getByRole("button", { name: /Можно повторить через 1:4\d/ });
  await expect(retry).toBeDisabled();
  await expect(page.getByRole("button", { name: /Можно повторить через 1:4[0-3]/ })).toBeVisible({ timeout: 6000 });
  await expect(page.getByRole("link", { name: ENTRY_REFUSAL_COPY.academySite })).toHaveAttribute("href", "http://localhost:3001/");
  await expect(page.getByRole("link", { name: ENTRY_REFUSAL_COPY.doctorSite })).toHaveAttribute("href", "http://localhost:3004/");
  await expect(page.locator("form")).toHaveCount(0);
  // No error banner (#3379): Next's app router injects its own permanent
  // `#__next-route-announcer__` live region, which is no page content.
  await expect(
    page.locator('[role="alert"]:not(#__next-route-announcer__)'),
  ).toHaveCount(0);
});

test("003 EARS-72: a rate-limited entry without Retry-After opens the retry at once, and the retry re-opens the same door URL", async ({
  page,
}) => {
  const res = await page.goto("/login?authRequest=REFUSE_429_BARE");
  expect(res?.status()).toBe(429);
  const retry = page.getByRole("button", { name: ENTRY_REFUSAL_COPY.retry });
  await expect(retry).toBeEnabled();
  const again = page.waitForResponse(
    (r) => r.request().isNavigationRequest() && r.url().endsWith("/login?authRequest=REFUSE_429_BARE"),
  );
  await retry.click();
  expect((await again).status()).toBe(429);
});

test("003 EARS-72: an entry the API cannot answer is a 503 refusal page with the retry open at once", async ({
  page,
}) => {
  const res = await page.goto("/login?authRequest=REFUSE_503");
  expect(res?.status()).toBe(503);
  expect(res?.headers()["retry-after"]).toBeUndefined();
  const heading = await page.getByRole("heading", { level: 1 }).textContent();
  expect(TITLES.unavailable).toContain(heading);
  await expect(page.getByRole("button", { name: ENTRY_REFUSAL_COPY.retry })).toBeEnabled();
});
