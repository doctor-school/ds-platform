import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  resolveAcademyShellAuth,
  type AcademyShellAuthLabels,
} from "./shell-auth";
import catalog from "../messages/ru.json";

/**
 * 008 EARS-4/5/6 — the academy header's sign-in branch, resolved on the SERVER
 * (#2281).
 *
 * The chrome's look for each branch is proven once in
 * `packages/storefront-shell/src/shell.test.tsx`; the shared guest short-circuit
 * and degrade rule in `packages/auth-flow/src/server/session.test.ts`. What is
 * host-owned — and asserted here — is the Academy projection: which read
 * yields the initials, and what the guest and signed-in clusters carry.
 */

const LABELS: AcademyShellAuthLabels = {
  login: catalog.shell.login,
  profile: catalog.shell.profile,
  myEvents: catalog.shell.myEvents,
};

const CLAIMS = { sub: "user-1", roles: ["doctor"], mfa: false };
const DOCTOR = {
  email: "doctor@ds.test",
  emailVerified: true,
  phone: null,
  phoneVerified: null,
  displayName: "Виктор Ковалёв",
};

const GUEST = {
  status: "guest",
  loginHref: "/login",
  label: catalog.shell.login,
} as const;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A request carrying the Academy session cookie and a fingerprint surface. */
function signedInRequest(): Headers {
  return new Headers({
    cookie: "__Host-ds_session=abc",
    "user-agent": "vitest",
    "accept-language": "ru",
    "x-forwarded-for": "203.0.113.7",
  });
}

/** Routes the two upstream reads the resolver may make. */
function upstream(session: () => Response, profile: () => Response) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/v1/auth/session")) return session();
    if (url.endsWith("/v1/me/profile")) return profile();
    throw new Error(`unexpected upstream read: ${url}`);
  });
}

beforeEach(() => {
  vi.stubEnv("API_PROXY_TARGET", "http://api.test");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("008 EARS-4/5/6: the academy header auth, read on the server", () => {
  it("008 EARS-4: no session cookie is a guest, with no upstream read at all", async () => {
    const fetchImpl = upstream(
      () => json(200, CLAIMS),
      () => json(200, DOCTOR),
    );

    const auth = await resolveAcademyShellAuth(
      new Headers(),
      LABELS,
      fetchImpl,
    );

    expect(auth).toEqual(GUEST);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("008 EARS-5/6: a signed-in doctor gets the initials chip → /account and «Мои события»", async () => {
    const fetchImpl = upstream(
      () => json(200, CLAIMS),
      () => json(200, DOCTOR),
    );

    const auth = await resolveAcademyShellAuth(
      signedInRequest(),
      LABELS,
      fetchImpl,
    );

    expect(auth).toEqual({
      status: "doctor",
      profileHref: "/account",
      label: catalog.shell.profile,
      initials: "ВК",
      links: [{ label: catalog.shell.myEvents, href: "/account/events" }],
    });
  });

  it("008 EARS-5: the profile read presents the same fingerprint surface the browser bound", async () => {
    const fetchImpl = upstream(
      () => json(200, CLAIMS),
      () => json(200, DOCTOR),
    );

    await resolveAcademyShellAuth(signedInRequest(), LABELS, fetchImpl);

    const profileCall = fetchImpl.mock.calls.find(([url]) =>
      String(url).endsWith("/v1/me/profile"),
    );
    expect(String(profileCall![0])).toBe("http://api.test/v1/me/profile");
    const init = (profileCall as unknown as [string, RequestInit])[1];
    const sent = new Headers(init.headers);
    expect(sent.get("cookie")).toBe("__Host-ds_session=abc");
    expect(sent.get("user-agent")).toBe("vitest");
    expect(sent.get("accept-language")).toBe("ru");
    expect(init.cache).toBe("no-store");
  });

  it("#997: a doctor with no saved display name still gets the initials chip, empty", async () => {
    const fetchImpl = upstream(
      () => json(200, CLAIMS),
      () => json(200, { ...DOCTOR, displayName: null }),
    );

    const auth = await resolveAcademyShellAuth(
      signedInRequest(),
      LABELS,
      fetchImpl,
    );

    expect(auth).toMatchObject({ status: "doctor", initials: null });
  });

  it("008 EARS-4: an expired session (401) is a guest, and no profile read follows", async () => {
    const fetchImpl = upstream(
      () => json(401, {}),
      () => json(200, DOCTOR),
    );

    const auth = await resolveAcademyShellAuth(
      signedInRequest(),
      LABELS,
      fetchImpl,
    );

    expect(auth).toEqual(GUEST);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("008 EARS-4: a failed session read degrades to the guest cluster", async () => {
    const fetchImpl = upstream(
      () => json(503, {}),
      () => json(200, DOCTOR),
    );

    const auth = await resolveAcademyShellAuth(
      signedInRequest(),
      LABELS,
      fetchImpl,
    );

    expect(auth).toEqual(GUEST);
  });

  it("008 EARS-4: a profile 401 after a live session is a guest", async () => {
    const fetchImpl = upstream(
      () => json(200, CLAIMS),
      () => json(401, {}),
    );

    const auth = await resolveAcademyShellAuth(
      signedInRequest(),
      LABELS,
      fetchImpl,
    );

    expect(auth).toEqual(GUEST);
  });

  it("008 EARS-4: a failed profile read degrades to the guest cluster, never a thrown page", async () => {
    const fetchImpl = upstream(
      () => json(200, CLAIMS),
      () => json(500, {}),
    );

    const auth = await resolveAcademyShellAuth(
      signedInRequest(),
      LABELS,
      fetchImpl,
    );

    expect(auth).toEqual(GUEST);
  });

  // A malformed profile body is a failed read under the shared degrade rule —
  // the guest cluster, never an exception thrown into the chrome.
  it.each([
    ["a non-string display name", { ...DOCTOR, displayName: 42 }],
    ["an object display name", { ...DOCTOR, displayName: { first: "Виктор" } }],
    ["a null body", null],
  ])(
    "008 EARS-4: a malformed profile (%s) degrades to the guest cluster, never a thrown page",
    async (_case, body) => {
      const fetchImpl = upstream(
        () => json(200, CLAIMS),
        () => json(200, body),
      );

      const auth = await resolveAcademyShellAuth(
        signedInRequest(),
        LABELS,
        fetchImpl,
      );

      expect(auth).toEqual(GUEST);
    },
  );
});
