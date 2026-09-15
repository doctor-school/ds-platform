/**
 * @vitest-environment node
 *
 * Reads the app router off disk, renders nothing — the portal's default jsdom
 * gives `import.meta.url` a non-file scheme and buys this suite nothing.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildRoomReturnHref } from "@ds/room/room-return";
import { describe, expect, it } from "vitest";

import { PORTAL_ROOM_ROUTES } from "../app/webinars/[slug]/room/room-routes";
import { ACADEMY_ROOM_ROUTES } from "./room-config";

/**
 * 006 EARS-6 — `ACADEMY_ROOM_ROUTES.room` is a HOST VALUE the shared codec
 * interpolates (wave-1 entry gate §2.1 rows 1–5), so nothing inside `@ds/room` can
 * tell whether it still names a route this app serves. Asserting the template
 * against itself would stay green through a route move while room return died in
 * production, so assert it against the ROUTER: the href the codec builds must
 * resolve to a real `page.tsx` under `apps/portal/app`.
 */
const LIB_DIR = fileURLToPath(new URL("./", import.meta.url));
const APP_ROUTER_DIR = path.resolve(LIB_DIR, "../app");
const SLUG = "ahilles-042";

describe("006 EARS-6 academy room host values (ACADEMY_ROOM_ROUTES)", () => {
  it("EARS-6: the room template resolves to the app-router segment this app actually serves", () => {
    const href = buildRoomReturnHref(SLUG, ACADEMY_ROOM_ROUTES);
    // The built href carries the concrete slug; the router spells that segment as
    // the dynamic `[slug]` folder.
    const segments = href
      .split("/")
      .filter(Boolean)
      .map((segment) => (segment === SLUG ? "[slug]" : segment));
    const routeFile = path.join(APP_ROUTER_DIR, ...segments, "page.tsx");

    expect(
      existsSync(routeFile),
      `room return points at ${href}, which no route serves: ${routeFile}`,
    ).toBe(true);
  });

  it("EARS-6: the room route table sends an unauthenticated visitor back to that same room url", () => {
    // The canonical auth target is built here, never re-spelled: if the template
    // and the router ever part ways, the assertion above fails first.
    expect(PORTAL_ROOM_ROUTES(SLUG).entry.auth).toBe(
      `/login?returnTo=${encodeURIComponent(buildRoomReturnHref(SLUG, ACADEMY_ROOM_ROUTES))}`,
    );
  });
});
