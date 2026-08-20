import { describe, expect, it } from "vitest";
import { scanRealRouteSet } from "./authz.gate.js";

/**
 * #1304 — "no handler can bypass live authority revalidation", as a machine
 * check rather than a convention.
 *
 * `AdminAuthorityGuard` is registered as an `APP_GUARD`, so *given* the
 * `revalidate: "live"` metadata the check provably runs. That closes half the
 * claim. The half this suite closes is the other one: that the metadata is
 * actually PRESENT on every admin mutation — because a guard driven by a
 * decorator is only as complete as the decorators someone remembered to write.
 *
 * The check runs over the REAL router (`scanRealRouteSet` boots AppModule and
 * enumerates what Nest actually registered — not an AST parse, not the OpenAPI
 * document), so a route added tomorrow is in scope the moment it exists. Its
 * shape is deliberately *default-deny*: every discovered
 * `POST|PATCH|PUT|DELETE /v1/admin/…` row must declare `revalidate: "live"`
 * unless it is named in {@link REVALIDATION_EXEMPT} with a reason. Adding a new
 * admin mutation therefore fails this test until it is either wired or
 * consciously exempted with a written justification a reviewer reads — the same
 * inversion `audit-emission-coverage.ts` uses for audit rows.
 */

/**
 * Routes deliberately outside live revalidation, each with the reason it cannot
 * or must not be wired. Every entry is a positive statement about the route, not
 * a "we did not get to it" — the two that ARE deferrals (007 events, 011 factor
 * removal) say so and are tracked in `DEBT.md` under #1304.
 */
const REVALIDATION_EXEMPT: Readonly<Record<string, string>> = {
  // ---- Auth-tier ENTRY routes: there is no admin session yet to revalidate.
  // These are `public` / `pending-auth` rows; requiring a live verdict on them
  // would be circular (you cannot revalidate the session you are creating).
  "POST /v1/admin/auth/login":
    "entry route — mints the session; nothing to revalidate yet",
  "POST /v1/admin/auth/mfa/enroll/start":
    "pending-auth enrollment step — no established admin session",
  "POST /v1/admin/auth/mfa/enroll/verify":
    "pending-auth enrollment step — no established admin session",
  "POST /v1/admin/auth/mfa/verify":
    "pending-auth step-up/verify step — the session is completed BY this call",

  // ---- Logout: availability outranks revalidation.
  "POST /v1/admin/auth/logout":
    "refusing a logout during an IdP outage would strand the operator signed in; " +
    "revoking local state is fail-safe in the same direction the guard is",

  // ---- Tracked deferrals (DEBT.md, #1304). Both are live in production under
  // their own feature's authority model; extending live revalidation to them is
  // a deliberate change to a shipped surface, not a side effect of this Issue.
  "DELETE /v1/admin/users/:id/mfa":
    "feature 011 break-glass factor removal, live in prod — 011-owned authority " +
    "model; extending revalidation there is tracked in DEBT.md (#1304)",
  "POST /v1/admin/events":
    "feature 007, live in prod — tracked in DEBT.md (#1304)",
  "PATCH /v1/admin/events/:id":
    "feature 007, live in prod — tracked in DEBT.md (#1304)",
  "POST /v1/admin/events/:id/open":
    "feature 007, live in prod — tracked in DEBT.md (#1304)",
  "POST /v1/admin/events/:id/close":
    "feature 007, live in prod — tracked in DEBT.md (#1304)",
  "POST /v1/admin/events/:id/archive":
    "feature 007, live in prod — tracked in DEBT.md (#1304)",
  "POST /v1/admin/events/:id/publish":
    "feature 007, live in prod — tracked in DEBT.md (#1304)",
  "POST /v1/admin/events/:id/transition":
    "feature 007, live in prod — tracked in DEBT.md (#1304)",
  "PUT /v1/admin/events/:id/stream":
    "feature 007, live in prod — tracked in DEBT.md (#1304)",
};

const MUTATING = /^(POST|PATCH|PUT|DELETE) /;

describe("live admin-authority revalidation coverage (#1304)", () => {
  it("#1304: every admin mutation declares revalidate: \"live\" or is a named exemption", async () => {
    const { rows } = await scanRealRouteSet();
    const adminMutations = rows.filter(
      (row) => MUTATING.test(row.endpoint) && row.endpoint.includes(" /v1/admin/"),
    );

    // A scan that found nothing would make this test vacuously green — the exact
    // failure mode a completeness guard must not have.
    expect(
      adminMutations.length,
      "the route scan found no admin mutations at all",
    ).toBeGreaterThan(0);

    const unwired = adminMutations
      .filter((row) => row.meta.revalidate !== "live")
      .map((row) => row.endpoint)
      .filter((endpoint) => !(endpoint in REVALIDATION_EXEMPT));

    expect(
      unwired,
      "admin mutations with neither revalidate: \"live\" nor an entry in " +
        "REVALIDATION_EXEMPT — wire the guard or record why it must not apply",
    ).toEqual([]);
  }, 60_000);

  it("#1304: the exemption registry names no route that has since disappeared", async () => {
    const { rows } = await scanRealRouteSet();
    const discovered = new Set(rows.map((row) => row.endpoint));
    // A stale exemption is how a registry rots into a rubber stamp: the entry
    // keeps reading as a considered decision long after the route it excused was
    // renamed, while the RENAMED route quietly needs a fresh decision.
    const stale = Object.keys(REVALIDATION_EXEMPT).filter(
      (endpoint) => !discovered.has(endpoint),
    );
    expect(stale, "exemptions for routes the router no longer registers").toEqual(
      [],
    );
  }, 60_000);

  it("#1304: no exemption silently covers a route that IS wired", async () => {
    const { rows } = await scanRealRouteSet();
    const wired = new Set(
      rows.filter((row) => row.meta.revalidate === "live").map((r) => r.endpoint),
    );
    const redundant = Object.keys(REVALIDATION_EXEMPT).filter((endpoint) =>
      wired.has(endpoint),
    );
    expect(
      redundant,
      "routes listed as exempt that actually revalidate — drop the exemption so " +
        "the registry keeps meaning what it says",
    ).toEqual([]);
  }, 60_000);
});
