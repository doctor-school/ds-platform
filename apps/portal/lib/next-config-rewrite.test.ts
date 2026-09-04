import { describe, expect, it } from "vitest";

import config from "../next.config";

/**
 * 006 EARS-3 / EARS-4 (#1722) — the HOST half of the room's transport invariant.
 *
 * `@ds/room` fires every room call at a RELATIVE `/v1/…` path with
 * `credentials: "include"` and deliberately takes no base URL: the session rides
 * the `__Host-ds_session` cookie, and the `__Host-` prefix locks that cookie to the
 * exact origin that set it, so each storefront must serve the BFF under its OWN
 * origin. The package can prove its own half (`packages/room/src/client/
 * room-api.test.ts` pins the paths, the verbs and `credentials`), but it can NEVER
 * prove this half: importing a `next.config.ts` would drag `next` into a package
 * whose whole point is being Next-free, and it would invert the app→package
 * dependency direction (D3 / D14b). Hence one small test per host, each importing
 * only its own config — the doctor twin is `apps/doctor/lib/next-config-rewrite.test.ts`.
 *
 * If this rewrite is ever dropped or narrowed, the room's relative fetches leave
 * the portal origin, the `__Host-` cookie does not ride, and every room call 401s
 * on a stand that otherwise looks healthy.
 */
describe("006 the portal /v1 rewrite carries the room's relative fetches", () => {
  it("006 EARS-3: the portal rewrites /v1/:path* to the api so the room relative fetches carry the __Host- session", async () => {
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
    // The capture is the WHOLE versioned surface — chat, heartbeat, room grant and
    // display-name all ride it; a narrower source would silently break one of them.
    expect(v1!.destination).toMatch(/\/v1\/:path\*$/);
  });
});
