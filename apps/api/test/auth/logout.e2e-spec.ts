import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import {
  DEVICE,
  DOCTOR,
  Jar,
  storefrontHarness,
  type StorefrontHarness,
} from "../setup/storefront-harness.js";

/**
 * 003 EARS-10 (amended), ADR-0015 §4 «One sign-out on both storefronts» req.
 * 6 — one sign-out on either storefront ends the shared session and every
 * storefront session linked to it, in one server-side call, through the
 * Session API v2 termination (`DELETE /v2/sessions/{id}`) — never an OIDC
 * `end_session` redirect, so no Zitadel V1 page can appear.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "003 EARS-10 — one sign-out on both storefronts (e2e)",
  () => {
    let h: StorefrontHarness;

    beforeAll(async () => {
      h = await storefrontHarness();
    });
    afterEach(async () => {
      vi.restoreAllMocks();
      await h.cleanup();
    });
    afterAll(async () => {
      await h.close();
    });

    function signOut(sid: string) {
      return h.app.inject({
        method: "POST",
        url: "/v1/auth/logout",
        headers: { ...DEVICE, cookie: `${SESSION_COOKIE_NAME}=${sid}` },
      });
    }

    async function expectSilentLoginRequired(jar: Jar) {
      const silent = h.hostIdp.seedAuthRequest({
        clientId: DOCTOR,
        prompt: ["none"],
      });
      const entry = await h.app.inject({
        method: "GET",
        url: `/v1/sign-in-host/entry?authRequest=${silent}`,
        headers: { ...DEVICE, cookie: jar.header() },
      });
      const body = entry.json() as { action: string; url?: string };
      expect(body.action === "redirect" && body.url).toContain(
        "error=login_required",
      );
    }

    it("EARS-10: a sign-out on storefront 1 with storefront 2 signed in leaves storefront 2's next request signed out, in one call with no end_session redirect", async () => {
      const address = await h.account("one");
      const jar = new Jar();
      const session = await h.hostSignIn(jar, address);
      const academy = await h.storefrontSession(session, "academy");
      const doctor = await h.storefrontSession(session, "doctor");
      const terminate = vi.spyOn(h.idp, "terminateSession");

      const out = await signOut(academy);

      expect(out.statusCode).toBe(200);
      expect(out.json()).toEqual({ status: "logged_out" });
      // The Session API v2 termination, synchronously — no redirect anywhere.
      expect(terminate).toHaveBeenCalledWith(
        expect.objectContaining({ zitadelSessionId: session.zitadelSessionId }),
      );
      expect(out.headers["location"]).toBeUndefined();
      expect(out.body).not.toMatch(/end_session|id_token_hint/);
      const cleared = out.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
      expect(cleared?.maxAge).toBe(0);
      expect(await h.sessionLive(academy)).toBe(false);
      expect(await h.sessionLive(doctor)).toBe(false);
      await expectSilentLoginRequired(jar);
    });

    it("EARS-10: two credential sign-ins in one browser and one sign-out leave no live session on either storefront; another browser keeps its own", async () => {
      const address = await h.account("two");
      const jar = new Jar();
      const first = await h.hostSignIn(jar, address);
      const academy = await h.storefrontSession(first, "academy");
      // The second credential step in the same browser replaces the shared
      // session (EARS-64), so the browser holds exactly one.
      const second = await h.hostSignIn(jar, address, { prompt: ["login"] });
      const doctor = await h.storefrontSession(second, "doctor");
      const academyAgain = await h.storefrontSession(second, "academy");
      const elsewhere = await h.storefrontSession(
        await h.hostSignIn(new Jar(), address),
        "academy",
      );

      expect((await signOut(doctor)).statusCode).toBe(200);

      for (const sid of [academy, doctor, academyAgain])
        expect(await h.sessionLive(sid)).toBe(false);
      expect(await h.sessionLive(elsewhere)).toBe(true);
      await expectSilentLoginRequired(jar);
    });
  },
);
