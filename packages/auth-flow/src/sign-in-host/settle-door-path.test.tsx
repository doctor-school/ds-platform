// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SettleDoorPath } from "./settle-door-path";

/**
 * 003 EARS-60 / 71 (lead decision, door stability) — the sign-in host settles
 * the address bar on the door the entry opened, so a reload, Back or Forward
 * within the same auth request re-enters THAT door by its own path while the
 * one-shot entry intent stays spent.
 */
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("003 EARS-71: the door the entry opened owns the address", () => {
  it("003 EARS-71: Zitadel's /login arrival rendering the registration door settles on /register, same query, no new history entry", () => {
    window.history.replaceState(null, "", "/login?authRequest=V2_1#top");
    const length = window.history.length;
    render(<SettleDoorPath door="register" />);
    expect(window.location.pathname).toBe("/register");
    expect(window.location.search).toBe("?authRequest=V2_1");
    expect(window.location.hash).toBe("#top");
    expect(window.history.length).toBe(length);
  });

  it("003 EARS-71: the reset door settles on /reset", () => {
    window.history.replaceState(null, "", "/login?authRequest=V2_1");
    render(<SettleDoorPath door="reset" />);
    expect(window.location.pathname).toBe("/reset");
    expect(window.location.search).toBe("?authRequest=V2_1");
  });

  it("003 EARS-71: a door already on its own path keeps the address and history state untouched", () => {
    const state = { kept: true };
    window.history.replaceState(state, "", "/login?authRequest=V2_1");
    render(<SettleDoorPath door="login" />);
    expect(window.location.pathname).toBe("/login");
    expect(window.history.state).toEqual(state);
  });
});
