import { test, expect } from "@playwright/test";

/**
 * Backend-free smoke for the doctor storefront (#1440): the shell renders, and
 * the same-origin BFF proxy is actually WIRED.
 *
 * The proxy assertion is the load-bearing one. `next.config.ts` freezes its
 * `rewrites()` destinations into `.next/routes-manifest.json` at BUILD time
 * (DSO-100), so a missing or mis-scoped rewrite cannot be caught by reading the
 * source — only by asking the built server. With no api running, a PROXIED
 * `/v1/*` request fails upstream and the server answers 5xx; an UNPROXIED one is
 * a plain Next 404. So "not 404" is exactly the backend-free signal that the
 * rewrite exists, and it is what keeps the `__Host-ds_session` cookie same-origin
 * on this host (ADR-0015 §4).
 */
test("#1440 storefront shell renders its landmarks", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("header")).toBeVisible();
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator("footer")).toBeVisible();
  await expect(page).toHaveTitle("Doctor.School");
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
});

test("#1440 /v1/* is proxied same-origin, not served as a Next route", async ({
  request,
}) => {
  const res = await request.get("/v1/auth/session");
  expect(
    res.status(),
    "a 404 means the /v1/* rewrite is missing from the built routes manifest",
  ).not.toBe(404);
  expect(res.status()).toBeGreaterThanOrEqual(500);
});
