import { test, expect } from "@playwright/test";
import { loginAsDoctor } from "./support/doctor-session";
import { requireLiveStandEnv } from "./support/live-stand-env";

/**
 * 017 EARS-1 / EARS-5 — the halves of the doctor storefront's shared chrome
 * (`@ds/storefront-shell`, #2180) that only a LIVE stand can prove:
 *
 * - the SIGNED-IN auth cluster. It is resolved on the SERVER from the
 *   `__Host-ds_session` cookie (ADR-0015 §4), so no browser-side route mock can
 *   reach it — the backend-free tier (`shell.spec.ts`) can only ever see the
 *   guest branch.
 * - the header SEARCH actually narrowing the feed. `DOCTOR_SHELL.search.action`
 *   is `/events`, and the storefront feed reads `q` for real
 *   (`apps/api/src/storefront/doctor-events.repository.ts` — `ilike` over the
 *   event title and school), so «submits to its target» is only half the
 *   contract: the answer has to change.
 *
 * ENV SET (`playwright.shell.config.ts`): `E2E_DOCTOR_URL`, `IDP_ISSUER`,
 * `MAILPIT_URL`, `E2E_DOCTOR_EMAIL`, `E2E_DOCTOR_PASSWORD`. Bare CI → inert
 * green; a HALF-exported env fails loudly by variable name (the gate module's
 * contract, `support/live-stand-env.ts`).
 *
 * The stand preconditions of that module apply here too — in particular the
 * raised rate-limit ceilings, since this tier logs in.
 */

requireLiveStandEnv([
  "E2E_DOCTOR_URL",
  "E2E_DOCTOR_EMAIL",
  "E2E_DOCTOR_PASSWORD",
]);

test.describe("017 EARS-1: the signed-in cluster on a live stand", () => {
  test("017 EARS-1.10: a signed-in doctor sees the doctor cluster only, and it navigates to the profile", async ({
    page,
  }) => {
    await loginAsDoctor(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const cluster = page.getByTestId("shell-action-cluster");
    await expect(cluster).toHaveCount(1);
    await expect(cluster).toHaveAttribute("data-cluster", "doctor");

    // The guest branch is GONE — never both clusters, never neither.
    await expect(cluster.getByRole("link", { name: "Войти" })).toHaveCount(0);
    await expect(
      cluster.getByRole("link", { name: "Регистрация" }),
    ).toHaveCount(0);

    const account = cluster.getByRole("link", { name: "Личный кабинет" });
    await expect(account).toHaveAttribute("href", "/account");
    await account.click();
    await expect(page).toHaveURL(/\/account(?:$|[?#/])/);
  });

  test("017 EARS-1.11: the chrome renders in both themes for a signed-in doctor", async ({
    page,
  }) => {
    await loginAsDoctor(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    for (const expectDark of [true, false]) {
      await page.getByTestId("theme-toggle").click();
      await expect
        .poll(() =>
          page.evaluate(() =>
            document.documentElement.classList.contains("dark"),
          ),
        )
        .toBe(expectDark);
      await expect(page.getByTestId("shell-action-cluster")).toBeVisible();
      await expect(page.getByTestId("storefront-header")).toBeVisible();
      await expect(page.getByTestId("storefront-footer")).toBeVisible();
    }
  });
});

test.describe("017 EARS-5: the header search narrows the shipped feed", () => {
  test("017 EARS-5.1: submitting the header search lands on the configured target with `q` and the feed answers it", async ({
    page,
  }) => {
    await page.goto("/events", { waitUntil: "domcontentloaded" });

    const feed = page.locator("[data-events-feed]");
    await expect(feed).toBeVisible();
    const cards = feed.locator('a[href^="/events/"]');
    const before = await cards.count();
    expect(before, "the live stand must carry a non-empty feed").toBeGreaterThan(
      0,
    );

    // Take a term the upstream really carries, so the narrowing is observable
    // rather than a guess about seed data.
    const title = (await cards.first().innerText()).trim();
    const term = title.split(/\s+/).find((word) => word.length > 4);
    expect(term, "the first feed card must carry a word to search for").toBeTruthy();

    const search = page.getByTestId("shell-search");
    await search.locator('input[name="q"]').fill(term!);
    await search.locator('input[name="q"]').press("Enter");

    // The configured target, carrying the query as `q` — a GET form, so the
    // narrowed view is a shareable URL.
    await expect(page).toHaveURL(
      new RegExp(`/events\\?[^#]*q=${encodeURIComponent(term!)}`, "i"),
    );

    const narrowed = page.locator("[data-events-feed]");
    await expect(narrowed).toBeVisible();
    const after = await narrowed.locator('a[href^="/events/"]').count();
    // The feed ANSWERED the query: the matching card survived, and the listing
    // is no wider than it was. (An upstream that ignored `q` would return the
    // full feed AND keep every non-matching card.)
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThanOrEqual(before);
    await expect(
      narrowed.locator('a[href^="/events/"]').first(),
    ).toContainText(new RegExp(term!, "i"));

    // The chrome rides the narrowed view, search input included.
    await expect(page.getByTestId("shell-search")).toHaveCount(1);
    await expect(page.getByTestId("storefront-header")).toBeVisible();
  });
});
