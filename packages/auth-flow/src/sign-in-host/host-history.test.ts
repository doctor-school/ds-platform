import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CODE_STEP_STATE_KEY,
  codeStepOf,
  hopHostDoor,
  isLeavingHost,
  leaveHost,
  pushCodeStep,
} from "./host-history";

/**
 * 003 EARS-5 / EARS-24 / EARS-71 — the sign-in host holds one history entry
 * of its own (plus the code step's), and leaving it replaces what it holds:
 * Back from the returned page is the page before the sign-in, never a spent
 * host address.
 */
type Listener = () => void;

function fakeWindow(state: unknown) {
  const listeners: Listener[] = [];
  const win = {
    location: { replace: vi.fn(), assign: vi.fn() },
    history: {
      state,
      back: vi.fn(() => {
        win.history.state = null;
        for (const l of listeners.splice(0)) l();
      }),
      pushState: vi.fn((next: unknown) => {
        win.history.state = next;
      }),
    },
    addEventListener: vi.fn((type: string, l: Listener) => {
      if (type === "popstate") listeners.push(l);
    }),
  };
  vi.stubGlobal("window", win);
  return win;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("003 EARS-5: leaving the sign-in host replaces its history entry", () => {
  it("003 EARS-5: from a door, the finished step replaces the host's entry — no new entry", () => {
    const win = fakeWindow({ __NA: true });
    leaveHost("https://id.example/callback?code=1");
    expect(win.location.replace).toHaveBeenCalledWith(
      "https://id.example/callback?code=1",
    );
    expect(win.location.assign).not.toHaveBeenCalled();
    expect(win.history.back).not.toHaveBeenCalled();
    expect(isLeavingHost()).toBe(true);
  });

  it("003 EARS-5 / EARS-24: from the code step's own entry it steps back onto the form's entry first, then replaces that", () => {
    const win = fakeWindow({ [CODE_STEP_STATE_KEY]: "doc@clinic.ru" });
    leaveHost("https://id.example/callback?code=2");
    expect(win.history.back).toHaveBeenCalledTimes(1);
    expect(win.location.replace).toHaveBeenCalledWith(
      "https://id.example/callback?code=2",
    );
    expect(win.history.back.mock.invocationCallOrder[0]).toBeLessThan(
      win.location.replace.mock.invocationCallOrder[0]!,
    );
  });
});

describe("003 EARS-71: a hop between doors replaces the host's entry", () => {
  it("003 EARS-71: hopHostDoor is a top-level navigation that replaces", () => {
    const win = fakeWindow(null);
    hopHostDoor("/register?authRequest=V2_1");
    expect(win.location.replace).toHaveBeenCalledWith(
      "/register?authRequest=V2_1",
    );
    expect(win.location.assign).not.toHaveBeenCalled();
  });
});

describe("003 EARS-24: the code step's own history entry", () => {
  it("003 EARS-24: pushCodeStep pushes one entry naming the address; codeStepOf reads it back", () => {
    const win = fakeWindow({ __NA: true });
    pushCodeStep("/verify?email=doc%40clinic.ru", "doc@clinic.ru");
    expect(win.history.pushState).toHaveBeenCalledWith(
      { [CODE_STEP_STATE_KEY]: "doc@clinic.ru" },
      "",
      "/verify?email=doc%40clinic.ru",
    );
    expect(codeStepOf(win.history.state)).toBe("doc@clinic.ru");
    expect(isLeavingHost()).toBe(false);
  });

  it("codeStepOf answers null for any other entry", () => {
    expect(codeStepOf(null)).toBeNull();
    expect(codeStepOf({ __NA: true })).toBeNull();
    expect(codeStepOf({ [CODE_STEP_STATE_KEY]: "" })).toBeNull();
    expect(codeStepOf("x")).toBeNull();
  });
});
