import {
  TOP_LEVEL_NAVIGATION_HEADERS,
  expectStorefrontEntry,
} from "@ds/e2e/storefront-entry";
import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * 003 EARS-61 / 71 (#3172) — the doctor storefront's sign-in entries hold no
 * form: each answers a `303` into a fresh interactive transaction on the
 * sign-in host and sets `__Host-ds_oidc_tx`. The forms themselves are proven
 * on the sign-in host tier (`apps/login/e2e/doctor-*.e2e.spec.ts`,
 * `playwright-axe-login`), each from the intent pinned here.
 *
 * Backend-free tier (`playwright.ci.config.ts`): the API's internal
 * transaction endpoint is the shared double
 * `packages/e2e/doubles/storefront-internal-api.mjs`, booted beside the built
 * app. A guest has no session, so no entry here takes the signed-in redirect
 * (that branch rides `login-arrival.spec.ts` on the return-context tier).
 */
const TRANSACTIONS = `http://127.0.0.1:${process.env.STOREFRONT_DOUBLE_PORT ?? 3217}/__transactions`;

const KNOWN = "prp-pri-gonartroze";
/** A well-formed Congress hand-off reference (003 EARS-44). */
const HANDOFF_REF = "Ab-_0123456789abcdefghijklmnopqrstuvwxyzABC";

/** The transaction body the entry sent, read back from the double. */
async function sentTransaction(
  request: APIRequestContext,
  location: URL,
): Promise<Record<string, unknown>> {
  const n = Number(location.searchParams.get("state")?.slice(3));
  const all = (await (await request.get(TRANSACTIONS)).json()) as Record<
    string,
    unknown
  >[];
  return all[n - 1]!;
}

const ENTRIES = [
  ["/login", { door: "login" }],
  // 021 #1945 — a gate arrival's `/webinars/<slug>` target lands on this
  // host's own `/events/<slug>`, its эфир is the EARS-71 event target, and
  // the callback completes the registration (005 EARS-2).
  [
    `/login?returnTo=%2Fwebinars%2F${KNOWN}`,
    {
      door: "login",
      returnPath: `/events/${KNOWN}`,
      intent: { eventTarget: KNOWN },
      completeRegistration: KNOWN,
    },
  ],
  // 003 EARS-43 — the Congress entry opens on «По коду»; the account target
  // is a return path, never an event target or a registration.
  ["/login?method=code", { door: "login", intent: { method: "code" } }],
  [
    "/login?method=code&returnTo=%2Faccount%2Fcongress",
    {
      door: "login",
      returnPath: "/account/congress",
      intent: { method: "code" },
    },
  ],
  // 003 EARS-44 — a well-formed hand-off reference is kept only in the
  // server-held entry intent.
  [
    `/login?method=code&handoff=${HANDOFF_REF}&returnTo=%2Faccount%2Fcongress`,
    {
      door: "login",
      returnPath: "/account/congress",
      intent: { method: "code", handoff: HANDOFF_REF },
    },
  ],
  ["/register", { door: "register" }],
  [
    `/register?returnTo=%2Fevents%2F${KNOWN}`,
    {
      door: "register",
      returnPath: `/events/${KNOWN}`,
      intent: { eventTarget: KNOWN },
      completeRegistration: KNOWN,
    },
  ],
  ["/reset", { door: "reset", intent: {} }],
  ["/verify", { door: "register" }],
] as const;

test.describe("003 EARS-61 — the doctor sign-in entries answer a 303 into the sign-in host", () => {
  for (const [path, transaction] of ENTRIES) {
    test(`EARS-61: ${path} answers 303 to the authorize URL and sets __Host-ds_oidc_tx`, async ({
      request,
    }) => {
      await expectStorefrontEntry(request, path, TRANSACTIONS, {
        transaction: { client: "doctor", kind: "interactive", ...transaction },
      });
    });
  }

  test("003 EARS-44: the hand-off entry never leaks the reference as a Referer", async ({
    request,
  }) => {
    const res = await request.get(`/login?method=code&handoff=${HANDOFF_REF}`, {
      maxRedirects: 0,
      headers: TOP_LEVEL_NAVIGATION_HEADERS,
    });
    expect(res.status()).toBe(303);
    expect(res.headers()["referrer-policy"]).toBe("no-referrer");
    expect(res.headers()["location"]).not.toContain(HANDOFF_REF);
  });

  test("003 EARS-44: a malformed reference is dropped — the intent is the plain code method", async ({
    request,
  }) => {
    const location = await expectStorefrontEntry(
      request,
      "/login?method=code&handoff=garbage",
      TRANSACTIONS,
      {
        transaction: {
          client: "doctor",
          door: "login",
          intent: { method: "code" },
        },
      },
    );
    const sent = await sentTransaction(request, location);
    expect(sent.intent).toEqual({ method: "code" });
  });

  for (const query of ["", "?method=bogus"]) {
    test(`003 EARS-43: /login${query} records no intent — the door keeps «Пароль»`, async ({
      request,
    }) => {
      const location = await expectStorefrontEntry(
        request,
        `/login${query}`,
        TRANSACTIONS,
        { transaction: { client: "doctor", door: "login" } },
      );
      expect(await sentTransaction(request, location)).not.toHaveProperty(
        "intent",
      );
    });
  }

  test("021 EARS-2.5 / 005 EARS-2: a cross-origin `returnTo` is no target at all", async ({
    request,
  }) => {
    const location = await expectStorefrontEntry(
      request,
      `/register?returnTo=${encodeURIComponent(`https://evil.example/webinars/${KNOWN}`)}`,
      TRANSACTIONS,
      { transaction: { client: "doctor", door: "register" } },
    );
    const sent = await sentTransaction(request, location);
    expect(sent).not.toHaveProperty("intent");
    expect(sent).not.toHaveProperty("returnPath");
    expect(sent).not.toHaveProperty("completeRegistration");
  });
});
