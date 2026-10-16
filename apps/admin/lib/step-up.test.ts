import { describe, expect, it } from "vitest";
import {
  STEP_UP_REPLAY_TTL_MS,
  clearStepUpRequest,
  isStepUpRequired,
  markStepUpConfirmed,
  reverifyReturnTo,
  saveStepUpRequest,
  stepUpChallengeHref,
  takeStepUpRequest,
  type StepUpStorage,
} from "./step-up";

/**
 * 047 EARS-8 — the console half of ADR-0001 §10: a `401 STEP_UP_REQUIRED` keeps
 * the pending request, sends the operator to the code screen, and the original
 * request is sent again — once — after the code.
 */
function memoryStorage(): StepUpStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const throwingStorage: StepUpStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

const REQUEST = {
  method: "POST" as const,
  path: "/v1/admin/staff-access/grants",
  body: { email: "a@b.ru", fullName: "Иванова Анна", role: "platform_admin" },
  context: { eventLabel: null },
};

describe("047 EARS-8 step-up — the console keeps the request across the code screen", () => {
  it("047 EARS-8: only a 401 naming STEP_UP_REQUIRED with a stepUpUrl is a step-up refusal", () => {
    expect(
      isStepUpRequired({
        statusCode: 401,
        errorCode: "STEP_UP_REQUIRED",
        stepUpUrl: "/mfa/challenge?mode=reverify",
      }),
    ).toBe(true);
    expect(isStepUpRequired({ statusCode: 401 })).toBe(false);
    expect(
      isStepUpRequired({ statusCode: 401, errorCode: "STEP_UP_REQUIRED" }),
    ).toBe(false);
    expect(
      isStepUpRequired({
        statusCode: 403,
        errorCode: "STEP_UP_REQUIRED",
        stepUpUrl: "/mfa/challenge?mode=reverify",
      }),
    ).toBe(false);
    expect(isStepUpRequired(null)).toBe(false);
  });

  it("047 EARS-8: the code screen is the server's stepUpUrl with the return path and the refused endpoint", () => {
    const href = stepUpChallengeHref(
      "/mfa/challenge?mode=reverify",
      "/access",
      "POST /v1/admin/staff-access/grants",
    );
    expect(href).not.toBeNull();
    const url = new URL(href!, "http://admin.test");
    expect(url.pathname).toBe("/mfa/challenge");
    expect(url.searchParams.get("mode")).toBe("reverify");
    expect(url.searchParams.get("returnTo")).toBe("/access");
    expect(url.searchParams.get("endpoint")).toBe(
      "POST /v1/admin/staff-access/grants",
    );
    // An off-origin stepUpUrl is never followed.
    expect(
      stepUpChallengeHref("https://evil.example/x", "/access", "POST /x"),
    ).toBeNull();
    expect(
      stepUpChallengeHref("//evil.example/x", "/access", "POST /x"),
    ).toBeNull();
  });

  it("047 EARS-8: the return path is an admin path starting with a single /, else /events", () => {
    expect(reverifyReturnTo("/access")).toBe("/access");
    expect(reverifyReturnTo("//evil.example")).toBe("/events");
    expect(reverifyReturnTo("https://evil.example")).toBe("/events");
    expect(reverifyReturnTo("/\\evil.example")).toBe("/events");
    expect(reverifyReturnTo(null)).toBe("/events");
  });

  it("047 EARS-8: a return path that a URL parser would turn off-origin is refused; a valid one comes back normalised", () => {
    for (const hostile of [
      "/\t/evil.com",
      "/\n/evil.com",
      "/\r/evil.com",
      "/%09/evil.com",
      "/\\evil.com",
      "//evil.com",
      "https://evil.com",
      "javascript:alert(1)",
      "",
    ]) {
      expect(reverifyReturnTo(hostile)).toBe("/events");
      expect(stepUpChallengeHref(hostile, "/access", "POST /x")).toBeNull();
      expect(
        stepUpChallengeHref("/mfa/challenge?mode=reverify", hostile, "POST /x"),
      ).toBeNull();
    }
    expect(reverifyReturnTo("/access?x=1")).toBe("/access?x=1");
    expect(reverifyReturnTo("/access?x=1#top")).toBe("/access?x=1#top");
    const href = stepUpChallengeHref(
      "/mfa/challenge?mode=reverify",
      "/access?x=1",
      "POST /x",
    );
    expect(
      new URL(href!, "http://admin.test").searchParams.get("returnTo"),
    ).toBe("/access?x=1");
  });

  it("047 EARS-8 / #2782: the re-verify return path obeys the one admin return-target rule — a dot-segment that normalises to `//`, a sign-in screen or a non-page path is refused", () => {
    for (const refused of [
      "/%2e%2e/%2fevil.example",
      "/login",
      "/mfa/challenge?mode=reverify",
      "/v1/admin/staff-access/grants",
    ]) {
      expect(reverifyReturnTo(refused)).toBe("/events");
      expect(
        stepUpChallengeHref("/mfa/challenge?mode=reverify", refused, "POST /x"),
      ).toBeNull();
    }
  });

  const OWNER = "csrf-session-a";
  const T0 = 1_760_000_000_000;
  const saved = (owner = OWNER, at = T0) =>
    saveStepUpRequest(memory, REQUEST, { owner, now: at });
  let memory = memoryStorage();
  const fresh = () => {
    memory = memoryStorage();
    return memory;
  };

  it("047 EARS-8: the saved request comes back once — for the same admin session, after a confirmed code, within the window — and for its own path only", () => {
    fresh();
    expect(saved()).toBe(true);
    markStepUpConfirmed(memory, T0 + 30_000);
    const scope = { owner: OWNER, now: T0 + 31_000 };
    expect(
      takeStepUpRequest(memory, "/v1/admin/staff-access/revocations", scope),
    ).toBeNull();
    expect(takeStepUpRequest(memory, REQUEST.path, scope)).toMatchObject(
      REQUEST,
    );
    expect(takeStepUpRequest(memory, REQUEST.path, scope)).toBeNull();
    expect(memory.data.size).toBe(0);
  });

  it("047 EARS-8: without a confirmed code the saved request is discarded, not sent — an abandoned code screen never replays", () => {
    fresh();
    saved();
    expect(
      takeStepUpRequest(memory, REQUEST.path, {
        owner: OWNER,
        now: T0 + 5_000,
      }),
    ).toBeNull();
    expect(memory.data.size).toBe(0);
  });

  it("047 EARS-8: a request saved by another admin session is discarded, even after a confirmed code", () => {
    fresh();
    saved("csrf-session-a");
    markStepUpConfirmed(memory, T0 + 10_000);
    expect(
      takeStepUpRequest(memory, REQUEST.path, {
        owner: "csrf-session-b",
        now: T0 + 11_000,
      }),
    ).toBeNull();
    expect(memory.data.size).toBe(0);
  });

  it("047 EARS-8: no session to bind to — nothing is saved, and nothing is replayed to an unknown session", () => {
    fresh();
    expect(saveStepUpRequest(memory, REQUEST, { owner: null, now: T0 })).toBe(
      false,
    );
    expect(memory.data.size).toBe(0);
    saved();
    markStepUpConfirmed(memory, T0 + 1_000);
    expect(
      takeStepUpRequest(memory, REQUEST.path, { owner: null, now: T0 + 2_000 }),
    ).toBeNull();
    expect(memory.data.size).toBe(0);
  });

  it("047 EARS-8: a request older than the replay window is discarded", () => {
    fresh();
    saved();
    const late = T0 + STEP_UP_REPLAY_TTL_MS + 1;
    markStepUpConfirmed(memory, late - 1_000);
    expect(
      takeStepUpRequest(memory, REQUEST.path, { owner: OWNER, now: late }),
    ).toBeNull();
    expect(memory.data.size).toBe(0);
    expect(STEP_UP_REPLAY_TTL_MS).toBeLessThanOrEqual(30 * 60_000);
  });

  it("047 EARS-8: a confirmation older than the saved request does not count for it", () => {
    fresh();
    markStepUpConfirmed(memory, T0 - 60_000);
    saved();
    expect(
      takeStepUpRequest(memory, REQUEST.path, {
        owner: OWNER,
        now: T0 + 1_000,
      }),
    ).toBeNull();
    expect(memory.data.size).toBe(0);
  });

  it("047 EARS-8: sign-out clears the saved request and its confirmation", () => {
    fresh();
    saved();
    markStepUpConfirmed(memory, T0 + 1_000);
    clearStepUpRequest(memory);
    expect(memory.data.size).toBe(0);
    clearStepUpRequest(null);
    clearStepUpRequest(throwingStorage);
  });

  it("047 EARS-8: blocked or corrupt storage keeps nothing and never throws", () => {
    const scope = { owner: OWNER, now: T0 };
    expect(saveStepUpRequest(throwingStorage, REQUEST, scope)).toBe(false);
    expect(takeStepUpRequest(throwingStorage, REQUEST.path, scope)).toBeNull();
    expect(saveStepUpRequest(null, REQUEST, scope)).toBe(false);
    expect(takeStepUpRequest(null, REQUEST.path, scope)).toBeNull();
    markStepUpConfirmed(null, T0);
    markStepUpConfirmed(throwingStorage, T0);
    const storage = memoryStorage();
    storage.data.set("ds-admin:step-up-request", "{not json");
    expect(takeStepUpRequest(storage, REQUEST.path, scope)).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  it("047 EARS-8: one screen reads the one saved request for any of its paths — a grant or a revocation — under the same replay rules", () => {
    const REVOKE = {
      method: "POST" as const,
      path: "/v1/admin/staff-access/revocations",
      body: { userId: "sub-2", role: "event-registrar", eventId: "e-1" },
      context: { rowKey: "sub-2:event-registrar:e-1" },
    };
    const paths = [REQUEST.path, REVOKE.path] as const;
    const scope = { owner: OWNER, now: T0 + 31_000 };

    fresh();
    saveStepUpRequest(memory, REVOKE, { owner: OWNER, now: T0 });
    markStepUpConfirmed(memory, T0 + 30_000);
    expect(takeStepUpRequest(memory, paths, scope)).toMatchObject(REVOKE);
    expect(takeStepUpRequest(memory, paths, scope)).toBeNull();
    expect(memory.data.size).toBe(0);

    fresh();
    saveStepUpRequest(memory, REVOKE, { owner: OWNER, now: T0 });
    expect(takeStepUpRequest(memory, paths, scope)).toBeNull();
    expect(memory.data.size).toBe(0);

    fresh();
    saveStepUpRequest(memory, REVOKE, { owner: OWNER, now: T0 });
    markStepUpConfirmed(memory, T0 + 30_000);
    expect(takeStepUpRequest(memory, [REQUEST.path], scope)).toBeNull();
    expect(memory.data.size).toBe(2);
  });
});
