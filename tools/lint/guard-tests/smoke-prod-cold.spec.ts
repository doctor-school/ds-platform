import { describe, expect, it } from "vitest";

import {
  COLD_ERROR_MARKERS,
  checkColdPage,
  checkRegisterClosed,
  findColdErrorMarker,
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

// A trimmed portal /login COLD body (#885): the portal login form is
// CLIENT-rendered, so the raw server HTML carries NO <input> — only the Next
// App-Router shell and its RSC flight stream (`self.__next_f`). This is what a
// HEALTHY cold portal /login looks like; asserting "<input" here (the pre-#885
// probe) would false-positive on a working page.
const CLIENT_RENDERED_PORTAL_LOGIN_BODY = `<!DOCTYPE html><html><head><title>Doctor.School</title></head>
<body><script>self.__next_f=self.__next_f||[];self.__next_f.push([1,"login shell"])</script>
<script src="/_next/static/chunks/app.js"></script></body></html>`;

// A portal error boundary streamed with status 200 (a server component threw):
// no form, but the Next production boundary markers ARE present — the #866
// failure mode a client-rendered probe must still reject.
const PORTAL_ERROR_BOUNDARY_BODY = `<!DOCTYPE html><html><body><h2>Application error: a server-side exception has occurred while loading app.doctor.school (see the server logs for more information).</h2><p>Digest: 987654321</p></body></html>`;

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
    expect(() =>
      checkColdPage({ status: 302, body: "" }),
    ).toThrow(/→ 302/);
  });

  it("rejects a blank/degraded 200 render missing the expected form markup", () => {
    expect(() =>
      checkColdPage({ status: 200, body: "<!DOCTYPE html><html><body></body></html>" }),
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

describe("smoke-prod checkColdPage() — client-rendered portal /login (#885)", () => {
  // The portal /login form hydrates client-side, so the probe asserts the
  // server-streamed app-shell signal instead of the (absent-cold) <input>.
  const clientRendered = { requireMarkup: "self.__next_f" };

  it("PASSES a healthy cold portal /login whose form hydrates client-side (no <input> in raw HTML)", () => {
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
