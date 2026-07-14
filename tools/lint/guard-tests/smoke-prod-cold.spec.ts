import { describe, expect, it } from "vitest";

import {
  COLD_ERROR_MARKERS,
  checkColdPage,
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
