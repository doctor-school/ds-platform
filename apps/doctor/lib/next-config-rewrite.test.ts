import { describe, expect, it } from "vitest";

import config from "../next.config";

/**
 * 006 EARS-3 / EARS-4 (#1722) — the doctor-host half of the room's transport
 * invariant, and the twin of `apps/portal/lib/next-config-rewrite.test.ts`.
 *
 * The shared room unit (`@ds/room`) fires every call at a RELATIVE `/v1/…` path
 * with `credentials: "include"` and takes no base URL. That is only correct while
 * BOTH hosts proxy `/v1/*` under their own origin: `doctor.school` and
 * `academy.doctor.school` are different origins and therefore hold SEPARATE
 * `__Host-ds_session` cookies (ADR-0015 §4), so the invariant is per-origin and
 * cannot be inherited from the portal. Each test imports only its OWN config —
 * a cross-app import is exactly what `cross-host-isolation.test.ts` forbids, and a
 * config import inside the package would break its Next-freedom (D3 / D14b).
 */
describe("006 the doctor storefront /v1 rewrite carries the room's relative fetches", () => {
  it("006 EARS-3: the doctor storefront rewrites /v1/:path* to the api so the room relative fetches carry the __Host- session", async () => {
    expect(typeof config.rewrites).toBe("function");
    const rewrites = await config.rewrites!();
    const rules = Array.isArray(rewrites)
      ? rewrites
      : [
          ...(rewrites.beforeFiles ?? []),
          ...(rewrites.afterFiles ?? []),
          ...(rewrites.fallback ?? []),
        ];
    const v1 = rules.find((rule) => rule.source === "/v1/:path*");
    expect(v1).toBeDefined();
    expect(v1!.destination).toMatch(/\/v1\/:path\*$/);
  });
});
