import { describe, expect, it } from "vitest";
import { scanRealRouteSet } from "../../src/authz/authz.gate.js";

/**
 * Emission-completeness guard (#135 — resolving #90).
 *
 * Auth/security audit is **explicit emission by design**: every state-changing
 * auth command appends its terminal `auth_audit` row at the command site (the
 * `AuthAuditLog` port), NOT via an `@Authz`-driven interceptor (ADR-0002 §4.8;
 * authz/README.md). The one risk that design carries is the very thing an
 * interceptor would have removed for free: a *new* state-changing command could
 * be added that silently forgets to emit. `audit-ledger.e2e-spec.ts` asserts the
 * one-terminal-row invariant **per event** — but it cannot fail for a row that
 * was never wired.
 *
 * This guard closes that gap. The `@Authz({ audit: "high-stakes" })` class is the
 * SSOT for "this route is a state-changing/security command that owes a terminal
 * audit row" (endpoint-authorization-matrix-design §3). We discover the real
 * high-stakes route set over the actual Nest router (the same `scanRealRouteSet`
 * the endpoint-authz gate uses — no bespoke AST parse) and cross-check it against
 * the explicit, reviewed coverage registry
 * (`src/authz/audit-emission-coverage.ts`). Each registry entry names the
 * `AuthAuditEvent` type(s) the route emits and the covering e2e `it`, records an
 * explicitly-tracked deferral (Issue #), or states — with a spec citation — that
 * the route owes no durable row at all (`noneBySpec`).
 *
 * The guard FAILS when:
 *   1. a discovered `high-stakes` route has no registry entry — someone added a
 *      state-changing handler and (probably) forgot its terminal emission;
 *   2. a registry entry references a route discovery does not find — the registry
 *      drifted (route renamed/removed);
 *   3. an entry is not a well-formed accounting — a bare `emits: []`, an event
 *      outside the taxonomy, a deferral with no Issue, or a `noneBySpec` with no
 *      reason/spec citation (`validateCoverageEntry`, unit-tested in
 *      `src/authz/audit-emission-coverage.spec.ts`).
 *
 * Adding a new high-stakes route therefore forces the author to declare, in a
 * reviewed table, how its terminal row is emitted (or to file the deferral, or to
 * cite the spec that forbids the row) — the discipline is enforced, not left to
 * per-event vigilance.
 *
 * Unlike the other files here this guard issues no query (route discovery is
 * pure), so it does not strictly need Postgres — but it boots the real AppModule
 * via `scanRealRouteSet`, so it lives with the e2e suite that already has the
 * application wired.
 */

import {
  HIGH_STAKES_AUDIT_COVERAGE,
  validateCoverageEntry,
} from "../../src/authz/audit-emission-coverage.js";

describe.skipIf(!process.env.DATABASE_URL)(
  "Auth-audit emission completeness (high-stakes routes)",
  () => {
    it("every audit:high-stakes route is accounted for in the coverage registry, and the registry has no stale entries", async () => {
      const { rows, violations } = await scanRealRouteSet();
      // Sanity: the underlying authz gate must itself be clean, else the
      // discovered set is meaningless.
      expect(violations).toEqual([]);

      const discovered = rows
        .filter((r) => r.meta.audit === "high-stakes")
        .map((r) => r.endpoint)
        .sort();

      const registered = Object.keys(HIGH_STAKES_AUDIT_COVERAGE).sort();

      // (1) Forgotten emission: a discovered high-stakes route with no registry
      // entry. This is the failure the guard exists to catch — a new
      // state-changing command added without declaring its terminal emission.
      const unregistered = discovered.filter(
        (e) => !(e in HIGH_STAKES_AUDIT_COVERAGE),
      );
      expect(
        unregistered,
        `New audit:high-stakes route(s) with no emission-coverage entry: ${unregistered.join(
          ", ",
        )}. Add a line to HIGH_STAKES_AUDIT_COVERAGE naming the AuthAuditEvent it emits + the covering e2e it, a tracked deferral (if the row is genuinely not owed yet), or a noneBySpec entry citing the spec clause that says the route owes no durable row. Auth audit is explicit-emission-by-design (ADR-0002 §4.8) — the row must be wired at the command site.`,
      ).toEqual([]);

      // (2) Stale registry: an entry whose route discovery no longer finds.
      const orphaned = registered.filter((e) => !discovered.includes(e));
      expect(
        orphaned,
        `Coverage-registry entries for route(s) the router no longer exposes: ${orphaned.join(
          ", ",
        )}. Remove the stale line(s) from HIGH_STAKES_AUDIT_COVERAGE.`,
      ).toEqual([]);

      // Belt-and-braces: the two sets are exactly equal.
      expect(discovered).toEqual(registered);
    });

    it("every registry entry is a well-formed accounting (emits in taxonomy / tracked deferral / cited none-by-spec)", () => {
      // Same validator the unit spec exercises — one definition of what the
      // registry accepts, asserted here against the live registry.
      const findings = Object.entries(HIGH_STAKES_AUDIT_COVERAGE).flatMap(
        ([endpoint, coverage]) => validateCoverageEntry(endpoint, coverage),
      );
      expect(findings, findings.join("\n")).toEqual([]);
    });
  },
);
