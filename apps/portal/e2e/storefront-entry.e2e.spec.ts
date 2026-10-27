import { expectStorefrontEntry } from "@ds/e2e/storefront-entry";
import { test } from "@playwright/test";

/**
 * 003 EARS-61 / 71 (#3172) — the Academy's sign-in entries hold no form: each
 * answers a `303` into a fresh interactive transaction on the sign-in host and
 * sets `__Host-ds_oidc_tx`. The forms themselves are proven on the sign-in
 * host tier (`apps/login/e2e`, `playwright-axe-login`).
 *
 * Backend-free tier: the API's internal transaction endpoint is the shared
 * double `packages/e2e/doubles/storefront-internal-api.mjs`, booted by
 * `playwright.ci.config.ts` beside the built app.
 */
const TRANSACTIONS = `http://127.0.0.1:${process.env.STOREFRONT_DOUBLE_PORT ?? 3217}/__transactions`;

const ENTRIES = [
  ["/login", { door: "login" }],
  ["/login?returnTo=%2Faccount", { door: "login", returnPath: "/account" }],
  ["/login?method=code", { door: "login", intent: { method: "code" } }],
  ["/register", { door: "register" }],
  [
    "/register?returnTo=%2Fwebinars%2Fprp-pri-gonartroze",
    {
      door: "register",
      returnPath: "/webinars/prp-pri-gonartroze",
      intent: { eventTarget: "prp-pri-gonartroze" },
    },
  ],
  ["/reset", { door: "reset", intent: {} }],
  ["/verify", { door: "register" }],
] as const;

test.describe("003 EARS-61 — the Academy sign-in entries answer a 303 into the sign-in host", () => {
  for (const [path, transaction] of ENTRIES) {
    test(`EARS-61: ${path} answers 303 to the authorize URL and sets __Host-ds_oidc_tx`, async ({
      request,
    }) => {
      await expectStorefrontEntry(request, path, TRANSACTIONS, {
        transaction: { client: "academy", kind: "interactive", ...transaction },
      });
    });
  }
});
