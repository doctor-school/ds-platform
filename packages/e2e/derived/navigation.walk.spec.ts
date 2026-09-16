import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  HOSTS,
  HOST_IDS,
  baseUrlFor,
  loadNavigationModel,
  type HostConfig,
} from "../hosts.js";
import { itemsFor, landingEvidence } from "../navigation-model.js";
import type { NavigationItem } from "../navigation-model.js";
import { signInGoldenDoctor } from "../lib/sign-in.js";

/**
 * The DERIVED NAVIGATION WALK — staging/regression-contour tech spec §6.3, first
 * bullet (Issue #2067).
 *
 * It contains NO list of destinations. Each host configures its shared chrome
 * from its own `lib/navigation-model.ts`, and this walk loads that same array
 * (`loadNavigationModel`, the sanctioned package→app path in `hosts.ts`) and
 * visits every item it finds: once as a guest, once as the golden signed-in
 * doctor. A new chrome link therefore enters the regression suite the moment it
 * enters the model — «ten new links in a release enter both walks with zero edits
 * to any list».
 *
 * Per item the walk asserts the three things a 200 alone does not prove:
 *   • the response status is 200 — the page was served, not 404/500;
 *   • the pathname is the href the chrome links to — no silent redirect;
 *   • the landing evidence the model declares (`h1` text, or `data-surface` for a
 *     page that owns no `h1`) — this is the §6.2 rule, and it is what turns
 *     «200 but the WRONG page» (the #2012 class) into a red check.
 * A guest item that redirects to the host's login surface instead asserts the
 * login `h1` and that `returnTo` still carries the original href, because a
 * redirect that loses `returnTo` silently strands the guest after sign-in.
 *
 * ── Why both hosts run inside ONE Playwright project ─────────────────────────
 * The Gherkin suite gets one project per host because `bddgen` generates a
 * different test DIRECTORY per host tag filter. The walks have no such
 * per-project artifact: the host is DATA here, read from `HOSTS`. Parameterising
 * by data rather than by project keeps the test titles self-describing (each
 * title names its host) and keeps the walk from depending on when Playwright
 * loads a spec file relative to project selection. Addresses are therefore
 * absolute — `baseUrlFor(host)` — instead of leaning on a project `baseURL`.
 *
 * Base URLs are resolved INSIDE each test, never at module scope, so
 * `playwright test --list` enumerates the walk on a machine with no slot
 * configured and an unset `E2E_*_URL` fails one named test instead of hanging or
 * silently driving localhost.
 */

/** The golden doctor the walk signs in as — the ordinary verified audience. */
const WALK_DOCTOR = "verified-cardiologist";

async function assertLanding(
  page: Page,
  item: NavigationItem,
  where: string,
): Promise<void> {
  const evidence = landingEvidence(item);
  if (evidence.kind === "h1") {
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: evidence.value,
        exact: true,
      }),
      `the h1 of ${where}`,
    ).toBeVisible();
  } else {
    await expect(
      page.locator(`[data-surface="${evidence.value}"]`),
      `the data-surface marker of ${where}`,
    ).toBeVisible();
  }
}

// Top-level await: the navigation model is a MODULE the walk loads across the
// package→app boundary, so the item list only exists after an async import. This
// package is ESM (`"type": "module"`), which is what lets the spec await it at
// collection time and declare one test per item — the alternative, a single test
// that loops inside, would report ten destinations as one pass or one failure and
// lose the name of the one that broke.
for (const hostId of HOST_IDS) {
  const host: HostConfig = HOSTS[hostId];
  const model = await loadNavigationModel(host);

  test.describe(`${hostId} navigation`, () => {
    for (const item of itemsFor(model, "guest")) {
      test(`${hostId} guest → ${item.href}`, async ({ page }) => {
        const base = baseUrlFor(host);
        const response = await page.goto(`${base}${item.href}`, {
          waitUntil: "domcontentloaded",
        });
        expect(response, `no response for ${item.href}`).not.toBeNull();
        expect(response!.status(), `status of ${item.href}`).toBe(200);

        const landed = new URL(page.url()).pathname;
        if (landed === host.loginPath && item.href !== host.loginPath) {
          // The guest was sent to sign in. §6.3: assert the login surface really
          // rendered AND that the original destination survived as `returnTo`.
          await expect(
            page.getByRole("heading", {
              level: 1,
              name: host.loginHeading,
              exact: true,
            }),
            `the h1 of ${host.loginPath} after the ${item.href} redirect`,
          ).toBeVisible();
          expect(
            new URL(page.url()).searchParams.get("returnTo"),
            `returnTo after the ${item.href} redirect`,
          ).toBe(item.href);
          return;
        }

        expect(landed, `pathname after opening ${item.href}`).toBe(item.href);
        await assertLanding(page, item, `${hostId} ${item.href}`);
      });
    }

    const doctorItems = itemsFor(model, "doctor");
    if (doctorItems.length > 0) {
      test.describe("signed in", () => {
        test.beforeEach(async ({ page }) => {
          await signInGoldenDoctor(page, host, WALK_DOCTOR, baseUrlFor(host));
        });

        for (const item of doctorItems) {
          test(`${hostId} as doctor → ${item.href}`, async ({ page }) => {
            const response = await page.goto(
              `${baseUrlFor(host)}${item.href}`,
              {
                waitUntil: "domcontentloaded",
              },
            );
            expect(response, `no response for ${item.href}`).not.toBeNull();
            expect(response!.status(), `status of ${item.href}`).toBe(200);
            expect(
              new URL(page.url()).pathname,
              `pathname after opening ${item.href} as the golden doctor`,
            ).toBe(item.href);
            await assertLanding(page, item, `${hostId} ${item.href}`);
          });
        }
      });
    }
  });
}
