import { describe, expect, it } from "vitest";

import { ACADEMY_AUTH_FLOW } from "./auth-flow.host-config";
import { ACADEMY_ROOM_ROUTES } from "./room-config";
import { LOGIN_HREF, PROFILE_HREF } from "./shell-config";

/**
 * 008 EARS-4 / 006 EARS-6 — the Academy host config states its auth routes as
 * LITERALS, because it is DATA a server route file hands to `@ds/auth-flow` and
 * may not read back out of `lib/`. That inversion is only safe while the
 * literals still equal the SSOTs they were copied from: `lib/navigation-model.ts`
 * owns where the sign-in control and the profile chip point, and
 * `lib/room-config.ts` owns the room template `@ds/room` interpolates. This
 * suite is what fails when one of those moves and the auth flow does not.
 */
describe("ACADEMY_AUTH_FLOW.routes", () => {
  it("EARS-4: the login route equals the navigation model's one guest destination", () => {
    expect(ACADEMY_AUTH_FLOW.routes.login).toBe(LOGIN_HREF);
  });

  it("EARS-4: the account route equals the navigation model's profile destination", () => {
    expect(ACADEMY_AUTH_FLOW.routes.account).toBe(PROFILE_HREF);
  });

  it("EARS-6: the room a bounced visitor returns to is the room `@ds/room` serves", () => {
    expect(ACADEMY_AUTH_FLOW.routes.room).toBe(ACADEMY_ROOM_ROUTES.room);
  });
});
