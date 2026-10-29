import { describe, expect, it } from "vitest";

import {
  COLD_ERROR_MARKERS,
  checkApiReady,
  checkAuthorizeAnswer,
  checkColdPage,
  checkRegisterClosed,
  checkStorefrontEntry,
  checkStorefrontPrefetch,
  findColdErrorMarker,
  isDoctorProbeSkipped,
} from "../../deploy/smoke-prod.mjs";

/**
 * Unit cover for the #866 cold-surface classification in
 * `tools/deploy/smoke-prod.mjs`. Pure seams only (body/status classification);
 * no network. The regression pinned here: Next.js App Router streams RSC
 * pages, so a server-side exception renders the production error boundary
 * INTO an already-committed 200 — the pre-#866 `status < 400` login probe
 * stayed green for 9 days while every cookie-less login was broken.
 */

// A trimmed Next.js production error-boundary body — served with HTTP 200 by
// a streamed App Router page whose server component threw (the exact surface
// the zitadel-login container showed during the #866 PAT outage).
const ERROR_BOUNDARY_BODY = `<!DOCTYPE html><html><head><title>id.doctor.school</title></head>
<body><div style="text-align:center">
<h2>Application error: a server-side exception has occurred while loading id.doctor.school (see the server logs for more information).</h2>
<p>Digest: 1297538930</p>
</div></body></html>`;

// A trimmed healthy loginname screen: real form markup, no boundary.
const HEALTHY_LOGIN_BODY = `<!DOCTYPE html><html><head><title>Login</title></head>
<body><form><label for="loginName">Loginname</label>
<input type="text" id="loginName" name="loginName" autocomplete="username" />
<button type="submit">Continue</button></form></body></html>`;

// A trimmed COLD body of a client-rendered Next page (#885): its form is
// CLIENT-rendered, so the raw server HTML carries NO <input> — only the Next
// App-Router shell and its RSC flight stream (`self.__next_f`). This is what a
// HEALTHY cold client-rendered page looks like; asserting "<input" here (the pre-#885
// probe) would false-positive on a working page.
const CLIENT_RENDERED_PORTAL_LOGIN_BODY = `<!DOCTYPE html><html><head><title>Doctor.School</title></head>
<body><script>self.__next_f=self.__next_f||[];self.__next_f.push([1,"login shell"])</script>
<script src="/_next/static/chunks/app.js"></script></body></html>`;

// A portal error boundary streamed with status 200 (a server component threw):
// no form, but the Next production boundary markers ARE present — the #866
// failure mode a client-rendered probe must still reject.
const PORTAL_ERROR_BOUNDARY_BODY = `<!DOCTYPE html><html><body><h2>Application error: a server-side exception has occurred while loading academy.doctor.school (see the server logs for more information).</h2><p>Digest: 987654321</p></body></html>`;

describe("smoke-prod findColdErrorMarker()", () => {
  it("flags the Next production error boundary (both classic and Next 15 wording)", () => {
    expect(findColdErrorMarker(ERROR_BOUNDARY_BODY)).toBe(
      "Application error: a server-side exception",
    );
    expect(
      findColdErrorMarker(
        "…Application error: a server-side exception has occurred (see the server logs for more information).…",
      ),
    ).toBe("Application error: a server-side exception");
  });

  it("flags a bare digest line and a raw gateway 500 JSON body", () => {
    expect(findColdErrorMarker("<p>Digest: 123</p>")).toBe("Digest:");
    expect(findColdErrorMarker('{"error":"Internal server error"}')).toBe(
      "Internal server error",
    );
  });

  it("passes a healthy login page", () => {
    expect(findColdErrorMarker(HEALTHY_LOGIN_BODY)).toBeNull();
  });

  it("keeps the marker list non-empty (the probe's teeth)", () => {
    expect(COLD_ERROR_MARKERS.length).toBeGreaterThanOrEqual(3);
  });
});

describe("smoke-prod checkColdPage()", () => {
  it("accepts a real 200 login screen", () => {
    expect(() =>
      checkColdPage({ status: 200, body: HEALTHY_LOGIN_BODY }),
    ).not.toThrow();
  });

  it("REJECTS the #866 outage mode: error boundary streamed with status 200", () => {
    expect(() =>
      checkColdPage({
        status: 200,
        body: ERROR_BOUNDARY_BODY,
        url: "https://id.example/ui/v2/login/loginname",
      }),
    ).toThrow(/error page served WITH status 200/);
  });

  it("rejects a plain 500 (the raw flow-initiation failure)", () => {
    expect(() =>
      checkColdPage({
        status: 500,
        body: '{"error":"Internal server error"}',
      }),
    ).toThrow(/→ 500/);
  });

  it("rejects any non-200, including the pre-#866-green 3xx band", () => {
    expect(() => checkColdPage({ status: 302, body: "" })).toThrow(/→ 302/);
  });

  it("rejects a blank/degraded 200 render missing the expected form markup", () => {
    expect(() =>
      checkColdPage({
        status: 200,
        body: "<!DOCTYPE html><html><body></body></html>",
      }),
    ).toThrow(/markup "<input" missing/);
  });

  it("honours a custom markup requirement", () => {
    expect(() =>
      checkColdPage(
        { status: 200, body: "<main>hello</main>" },
        { requireMarkup: "<main" },
      ),
    ).not.toThrow();
  });
});

describe("smoke-prod checkColdPage() — client-rendered Next page (#885)", () => {
  // A client-rendered form hydrates client-side, so the check asserts the
  // server-streamed app-shell signal instead of the (absent-cold) <input>.
  const clientRendered = { requireMarkup: "self.__next_f" };

  it("PASSES a healthy cold client-rendered page whose form hydrates client-side (no <input> in raw HTML)", () => {
    expect(() =>
      checkColdPage(
        {
          status: 200,
          body: CLIENT_RENDERED_PORTAL_LOGIN_BODY,
          url: "https://app.example/login",
        },
        clientRendered,
      ),
    ).not.toThrow();
    // Regression pin: the pre-#885 "<input" default WOULD have wrongly rejected
    // this healthy page — the exact false positive this fix removes.
    expect(() =>
      checkColdPage({ status: 200, body: CLIENT_RENDERED_PORTAL_LOGIN_BODY }),
    ).toThrow(/markup "<input" missing/);
  });

  it("still REJECTS an error boundary streamed with status 200 (the #866 teeth survive)", () => {
    expect(() =>
      checkColdPage(
        {
          status: 200,
          body: PORTAL_ERROR_BOUNDARY_BODY,
          url: "https://app.example/login",
        },
        clientRendered,
      ),
    ).toThrow(/error page served WITH status 200/);
  });

  it("still REJECTS a blank/degraded 200 with no app-shell stream", () => {
    expect(() =>
      checkColdPage(
        { status: 200, body: "<!DOCTYPE html><html><body></body></html>" },
        clientRendered,
      ),
    ).toThrow(/markup "self.__next_f" missing/);
  });

  it("honours a multi-token requireMarkup (ALL tokens must be present)", () => {
    expect(() =>
      checkColdPage(
        { status: 200, body: CLIENT_RENDERED_PORTAL_LOGIN_BODY },
        { requireMarkup: ["self.__next_f", "_next/static"] },
      ),
    ).not.toThrow();
    expect(() =>
      checkColdPage(
        { status: 200, body: CLIENT_RENDERED_PORTAL_LOGIN_BODY },
        { requireMarkup: ["self.__next_f", "<input"] },
      ),
    ).toThrow(/markup "<input" missing/);
  });

  it("PASSES when the cookie-less request lands on the expected path", () => {
    expect(() =>
      checkColdPage(
        {
          status: 200,
          body: CLIENT_RENDERED_PORTAL_LOGIN_BODY,
          url: "https://app.example/login",
        },
        { ...clientRendered, expectPath: "/login" },
      ),
    ).not.toThrow();
  });

  it("REJECTS a /login that redirected away to another path (route-identity teeth)", () => {
    // A healthy 200 with valid app-shell markup, but landed on `/` — the exact
    // redirect-misconfig a render-only check would wave through green.
    expect(() =>
      checkColdPage(
        {
          status: 200,
          body: CLIENT_RENDERED_PORTAL_LOGIN_BODY,
          url: "https://app.example/",
        },
        { ...clientRendered, expectPath: "/login" },
      ),
    ).toThrow(/redirected off "\/login" to "\/"/);
  });
});

describe("smoke-prod checkRegisterClosed() — #877 public self-registration stays closed", () => {
  // Login-v2 register page with registration DISABLED on the default login
  // policy: the layout renders a disallowed notice, NO form field.
  const REGISTER_DISABLED_BODY = `<!DOCTYPE html><html><body><main><div>Регистрация недоступна</div></main></body></html>`;
  // Registration OPEN: the register form renders its fields — the door the
  // probe exists to catch if provisioning posture ever regresses.
  const REGISTER_FORM_BODY = `<!DOCTYPE html><html><body><form><input type="text" name="firstname" /><input type="email" name="email" /><button type="submit">Continue</button></form></body></html>`;

  it("PASSES a 200 register page rendering NO form field (disabled notice)", () => {
    expect(() =>
      checkRegisterClosed({
        status: 200,
        body: REGISTER_DISABLED_BODY,
        url: "https://id.example/ui/v2/login/register",
      }),
    ).not.toThrow();
  });

  it("PASSES a non-200 register route (surface not served at all)", () => {
    expect(() =>
      checkRegisterClosed({ status: 404, body: "not found" }),
    ).not.toThrow();
  });

  it("PASSES a register route that redirected AWAY from register", () => {
    expect(() =>
      checkRegisterClosed({
        status: 200,
        body: REGISTER_FORM_BODY, // even a form elsewhere is not the register door
        url: "https://id.example/ui/v2/login/loginname",
      }),
    ).not.toThrow();
  });

  it("REJECTS a 200 register page that renders a submittable form field", () => {
    expect(() =>
      checkRegisterClosed({
        status: 200,
        body: REGISTER_FORM_BODY,
        url: "https://id.example/ui/v2/login/register",
      }),
    ).toThrow(/self-registration appears OPEN/);
  });
});

/**
 * #1723 — the doctor probes must not turn an UNRELATED `pnpm deploy:prod` (or
 * a `--rollback`) RED while the owner-gated Beget A-record for
 * `new.doctor.school` is still pending: an unresolvable host fails both the
 * render and the TLS probe, `smoke-prod` exits 1, and `prod.mjs` die()s at the
 * smoke gate for a DNS reason. The switch is an operator flag with a probe-ON
 * default, so nobody has to remember to re-arm it after the DNS flip.
 */
describe("doctor probe skip switch (#1723)", () => {
  it("probes by default — PROD_DOCTOR_HOST unset", () => {
    expect(isDoctorProbeSkipped(undefined)).toBe(false);
  });

  it("probes against an explicit host override", () => {
    expect(isDoctorProbeSkipped("doctor.school")).toBe(false);
    expect(isDoctorProbeSkipped("new.doctor.school")).toBe(false);
  });

  it("skips on an explicitly EMPTY value (including whitespace)", () => {
    expect(isDoctorProbeSkipped("")).toBe(true);
    expect(isDoctorProbeSkipped("   ")).toBe(true);
  });

  it("skips on the literal `skip`, case- and space-insensitively", () => {
    expect(isDoctorProbeSkipped("skip")).toBe(true);
    expect(isDoctorProbeSkipped("SKIP")).toBe(true);
    expect(isDoctorProbeSkipped(" Skip ")).toBe(true);
  });
});

describe("api /v1/ready classification (002 EARS-3, #2821)", () => {
  const body = (checks: Record<string, string>, status = "ok") =>
    JSON.stringify({ status, checks, timestamp: "2026-10-12T00:00:00.000Z" });

  it("passes and lists every check when all are ok", () => {
    expect(
      checkApiReady({
        status: 200,
        body: body({ postgres: "ok", pgvector: "ok", objectStorage: "ok" }),
      }),
    ).toBe("200 · postgres=ok · pgvector=ok · objectStorage=ok");
  });

  it("names the failing check on a 503, so storage is told apart from the DB", () => {
    expect(() =>
      checkApiReady({
        status: 503,
        body: body(
          { postgres: "ok", pgvector: "ok", objectStorage: "down" },
          "down",
        ),
      }),
    ).toThrow("/v1/ready → 503 · objectStorage=down");
  });

  it("names every failing check", () => {
    expect(() =>
      checkApiReady({
        status: 503,
        body: body(
          { postgres: "down", pgvector: "down", objectStorage: "down" },
          "down",
        ),
      }),
    ).toThrow(
      "/v1/ready → 503 · postgres=down · pgvector=down · objectStorage=down",
    );
  });

  it("still requires postgres and pgvector, and accepts a build that predates objectStorage (rollback)", () => {
    expect(
      checkApiReady({
        status: 200,
        body: body({ postgres: "ok", pgvector: "ok" }),
      }),
    ).toBe("200 · postgres=ok · pgvector=ok");
    expect(() =>
      checkApiReady({ status: 200, body: body({ postgres: "ok" }) }),
    ).toThrow("/v1/ready → 200 · pgvector=undefined");
  });

  it("reports a non-JSON answer with its status", () => {
    expect(() =>
      checkApiReady({ status: 502, body: "<html>Bad Gateway</html>" }),
    ).toThrow("/v1/ready → 502 (body is not JSON: <html>Bad Gateway</html>)");
  });
});

describe("storefront sign-in entry /login, /verify (003 EARS-61/62/71, #3435)", () => {
  // Since #3265 the Academy entries render no form: a top-level navigation is
  // answered `303` to the IdP authorize URL with the storefront's one
  // redirect_uri, and any other GET (prefetch, fetch) a bodyless `204`.
  const hosts = { portalHost: "academy.example", idHost: "id.example" };
  const authorize = (
    redirectUri: string,
    host = "id.example",
    path = "/oauth/v2/authorize",
  ) =>
    `https://${host}${path}?client_id=123&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&code_challenge_method=S256`;
  const entry = (status: number, location?: string) => ({
    status,
    headers: location === undefined ? {} : { location },
    body: "",
  });

  it("PASSES a 303 to the IdP authorize URL carrying the storefront callback", () => {
    expect(
      checkStorefrontEntry(
        entry(303, authorize("https://academy.example/auth/callback")),
        hosts,
      ),
    ).toContain("303");
  });

  it("REJECTS the retired 200 app-shell page", () => {
    expect(() =>
      checkStorefrontEntry(
        { status: 200, headers: {}, body: "<script>self.__next_f=[]</script>" },
        hosts,
      ),
    ).toThrow("→ 200");
  });

  it("REJECTS a 204 to a navigation (the navigation headers did not reach the route)", () => {
    expect(() => checkStorefrontEntry(entry(204), hosts)).toThrow("→ 204");
  });

  it("REJECTS a 5xx", () => {
    expect(() => checkStorefrontEntry(entry(502), hosts)).toThrow("→ 502");
  });

  it("REJECTS a 303 with no Location", () => {
    expect(() => checkStorefrontEntry(entry(303), hosts)).toThrow("Location");
  });

  it("REJECTS a 303 to another host", () => {
    expect(() =>
      checkStorefrontEntry(
        entry(
          303,
          authorize("https://academy.example/auth/callback", "evil.example"),
        ),
        hosts,
      ),
    ).toThrow("evil.example");
  });

  it("REJECTS a 303 to another path on the IdP host", () => {
    expect(() =>
      checkStorefrontEntry(
        entry(
          303,
          authorize(
            "https://academy.example/auth/callback",
            "id.example",
            "/ui/v2/login/loginname",
          ),
        ),
        hosts,
      ),
    ).toThrow("/ui/v2/login/loginname");
  });

  it("REJECTS a 303 whose redirect_uri is not the storefront callback", () => {
    expect(() =>
      checkStorefrontEntry(
        entry(303, authorize("https://api.example/auth/callback")),
        hosts,
      ),
    ).toThrow("redirect_uri");
  });

  it("REJECTS a 303 back to the storefront itself (a signed-in landing, not a cold entry)", () => {
    expect(() =>
      checkStorefrontEntry(
        entry(303, "https://academy.example/account"),
        hosts,
      ),
    ).toThrow("academy.example");
  });

  it("PASSES the bodyless 204 answer to a non-navigation GET", () => {
    expect(checkStorefrontPrefetch(entry(204))).toContain("204");
  });

  it("REJECTS a non-navigation GET that started a sign-in (303) or failed (5xx)", () => {
    expect(() =>
      checkStorefrontPrefetch(
        entry(303, authorize("https://academy.example/auth/callback")),
      ),
    ).toThrow("→ 303");
    expect(() => checkStorefrontPrefetch(entry(500))).toThrow("→ 500");
  });
});

describe("IdP authorize answer behind the storefront entry (#3438)", () => {
  // The entry's 303 Location is fetched ONCE, cookie-less, not followed: a
  // registered redirect_uri draws Zitadel's 302 into the hosted login, an
  // unregistered one (or any other refused request) an error answer.
  const authorizeUrl =
    "https://id.example/oauth/v2/authorize?client_id=1&redirect_uri=https%3A%2F%2Facademy.example%2Fauth%2Fcallback";
  const answer = (status: number, location?: string, body = "") => ({
    status,
    headers: location === undefined ? {} : { location },
    body,
  });

  it("PASSES a 302 into the hosted login (/ui/v2/login/…)", () => {
    expect(
      checkAuthorizeAnswer(
        answer(302, "/ui/v2/login/login?authRequest=V2_1"),
        authorizeUrl,
      ),
    ).toContain("/ui/v2/login/login");
  });

  it("PASSES an absolute 302 into the hosted login on the IdP host", () => {
    expect(
      checkAuthorizeAnswer(
        answer(
          302,
          "https://id.example/ui/v2/login/loginname?authRequest=V2_1",
        ),
        authorizeUrl,
      ),
    ).toContain("/ui/v2/login/loginname");
  });

  const signInHost = { loginUi: { host: "login.example", path: "/login" } };

  it("PASSES a storefront client's 302 into the sign-in host (ADR-0015)", () => {
    expect(
      checkAuthorizeAnswer(
        answer(302, "https://login.example/login?authRequest=V2_1"),
        authorizeUrl,
        signInHost,
      ),
    ).toBe("authorize → 302 → login.example/login");
  });

  it("REJECTS the hosted login where the sign-in host is expected, and a path off it", () => {
    expect(() =>
      checkAuthorizeAnswer(
        answer(302, "/ui/v2/login/login?authRequest=V2_1"),
        authorizeUrl,
        signInHost,
      ),
    ).toThrow("expected login.example/login");
    expect(() =>
      checkAuthorizeAnswer(
        answer(302, "https://login.example/loginx?authRequest=V2_1"),
        authorizeUrl,
        signInHost,
      ),
    ).toThrow("outside the login UI");
  });

  it("REJECTS the IdP's error answer to an unregistered redirect_uri (4xx body)", () => {
    expect(() =>
      checkAuthorizeAnswer(
        answer(
          400,
          undefined,
          "The requested redirect_uri is missing in the client configuration.",
        ),
        authorizeUrl,
      ),
    ).toThrow("authorize → 400");
  });

  it("REJECTS an OAuth error redirect back to the storefront (?error=…)", () => {
    expect(() =>
      checkAuthorizeAnswer(
        answer(
          302,
          "https://academy.example/auth/callback?error=invalid_scope&error_description=bad",
        ),
        authorizeUrl,
      ),
    ).toThrow("invalid_scope");
  });

  it("REJECTS a redirect that leaves the hosted login", () => {
    expect(() =>
      checkAuthorizeAnswer(
        answer(302, "https://id.example/ui/console"),
        authorizeUrl,
      ),
    ).toThrow("outside the login UI");
  });

  it("REJECTS a 200 (an error page served in place of the redirect), naming a boundary marker", () => {
    expect(() =>
      checkAuthorizeAnswer(
        answer(200, undefined, ERROR_BOUNDARY_BODY),
        authorizeUrl,
      ),
    ).toThrow("Application error");
  });

  it("REJECTS a 5xx and a 3xx with no Location", () => {
    expect(() => checkAuthorizeAnswer(answer(502), authorizeUrl)).toThrow(
      "authorize → 502",
    );
    expect(() => checkAuthorizeAnswer(answer(302), authorizeUrl)).toThrow(
      "Location",
    );
  });
});
