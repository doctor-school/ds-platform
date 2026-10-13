import { describe, expect, it } from "vitest";
import {
  isStepUpRequired,
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

  it("047 EARS-8: the saved request is read back once, for its own path only", () => {
    const storage = memoryStorage();
    expect(saveStepUpRequest(storage, REQUEST)).toBe(true);
    expect(
      takeStepUpRequest(storage, "/v1/admin/staff-access/revocations"),
    ).toBeNull();
    expect(takeStepUpRequest(storage, REQUEST.path)).toEqual(REQUEST);
    expect(takeStepUpRequest(storage, REQUEST.path)).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  it("047 EARS-8: blocked or corrupt storage keeps nothing and never throws", () => {
    expect(saveStepUpRequest(throwingStorage, REQUEST)).toBe(false);
    expect(takeStepUpRequest(throwingStorage, REQUEST.path)).toBeNull();
    expect(saveStepUpRequest(null, REQUEST)).toBe(false);
    expect(takeStepUpRequest(null, REQUEST.path)).toBeNull();
    const storage = memoryStorage();
    storage.data.set("ds-admin:step-up-request", "{not json");
    expect(takeStepUpRequest(storage, REQUEST.path)).toBeNull();
    expect(storage.data.size).toBe(0);
  });
});
