import { ENTRY_REFUSAL_COPY } from "@ds/auth-flow/copy";
import { REFUSED_ENTRIES } from "@ds/e2e/storefront-entry";
import { expect, test } from "@playwright/test";

/**
 * 003 EARS-72 (#3379) — a doctor-storefront door whose transaction the API
 * refuses renders the refusal page inside the storefront shell at the
 * truthful status. Backend-free tier: the shared internal-API double refuses
 * the marked transactions (`packages/e2e/doubles/storefront-internal-api.mjs`).
 */
const titles = (k: "rate-limited" | "unavailable") =>
  ENTRY_REFUSAL_COPY.variants[k].map((v) => v.title);

test("003 EARS-72: a rate-limited door is a 429 refusal page counting down, its way out back to the эфир", async ({
  page,
}) => {
  const res = await page.goto(REFUSED_ENTRIES.rateLimitedFromEvent);
  expect(res?.status()).toBe(429);
  expect(res?.headers()["retry-after"]).toBe("105");
  expect(new URL(page.url()).pathname).toBe("/login");
  expect(titles("rate-limited")).toContain(
    await page.getByRole("heading", { level: 1 }).textContent(),
  );
  await expect(
    page.getByRole("button", { name: /Можно повторить через 1:4\d/ }),
  ).toBeDisabled();
  await expect(
    page
      .getByRole("main")
      .getByRole("link", { name: ENTRY_REFUSAL_COPY.backToEvent }),
  ).toHaveAttribute("href", /refuse-429$/);
  await expect(page.getByRole("banner").first()).toBeVisible();
});

test("003 EARS-72: a rate-limited door without Retry-After opens the retry at once; the way out is the home page", async ({
  page,
}) => {
  const res = await page.goto(REFUSED_ENTRIES.rateLimitedBare);
  expect(res?.status()).toBe(429);
  await expect(
    page.getByRole("button", { name: ENTRY_REFUSAL_COPY.retry }),
  ).toBeEnabled();
  await expect(
    page.getByRole("main").getByRole("link", { name: ENTRY_REFUSAL_COPY.home }),
  ).toHaveAttribute("href", "/");
});

test("003 EARS-72: a door the API cannot answer is a 503 refusal page; the retry re-opens the same door URL", async ({
  page,
}) => {
  const res = await page.goto(REFUSED_ENTRIES.unavailable);
  expect(res?.status()).toBe(503);
  expect(titles("unavailable")).toContain(
    await page.getByRole("heading", { level: 1 }).textContent(),
  );
  const again = page.waitForResponse(
    (r) =>
      r.request().isNavigationRequest() &&
      r.url().endsWith(REFUSED_ENTRIES.unavailable),
  );
  await page.getByRole("button", { name: ENTRY_REFUSAL_COPY.retry }).click();
  expect((await again).status()).toBe(503);
});
