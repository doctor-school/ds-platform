import { describe, expect, it } from "vitest";

import { FakeIdpClient } from "./idp.fake.js";
import type { FetchLike } from "./zitadel.idp.js";
import { ZitadelIdpClient } from "./zitadel.idp.js";

/**
 * 044 EARS-4 — the credential-less (passwordless) variant of the IdP create
 * port, proven on BOTH implementations.
 *
 * The congress intake creates an account for a participant who never chose a
 * password and never will on this surface: the sign-up form asks for a name, an
 * email and a phone, and nothing else. Sending a generated or empty credential
 * would create a real, guessable-by-nobody-but-still-real password on the
 * account; the adapter must instead OMIT the credential object entirely, which
 * Zitadel accepts (live dev-stand proof 2026-09-21: 200 / `USER_STATE_ACTIVE`).
 *
 * The fake mirrors that state, because fake/real parity is the regression net
 * this whole port is built on (#202).
 */

const BASE_CONFIG = {
  baseUrl: "http://idp.test:9080",
  serviceToken: "svc-token",
  orgId: "org-1",
};

interface RecordedCall {
  url: string;
  method: string;
  body?: string | undefined;
}

function recordingFetch(): {
  fetchImpl: FetchLike;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    calls.push({ url, method: init.method, body: init.body });
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: "new-sub" }),
    });
  };
  return { fetchImpl, calls };
}

describe("044 congress sign-up — passwordless IdP create (EARS-4)", () => {
  it("EARS-4: when the congress intake creates an account, system shall send a CreateUser body with no password member at all", async () => {
    const { fetchImpl, calls } = recordingFetch();
    const client = new ZitadelIdpClient({ ...BASE_CONFIG, fetchImpl });

    const created = await client.createUser({
      email: "participant@example.com",
      credential: "none",
      profile: { givenName: "Иван", familyName: "Петров" },
    });

    expect(created.alreadyExisted).toBe(false);
    expect(created.sub).toBe("new-sub");

    const create = calls.find((c) => c.url.endsWith("/v2/users/new"));
    expect(create?.method).toBe("POST");
    const body = JSON.parse(create?.body ?? "{}") as {
      human: Record<string, unknown> & {
        profile: Record<string, unknown>;
      };
    };
    // Omitted, not empty: `password: { password: "" }` would be a credential.
    expect(Object.keys(body.human)).not.toContain("password");
    expect(JSON.stringify(body)).not.toContain("password");
  });

  it("EARS-4: when the participant submitted their name, system shall send that name to the IdP instead of the registration placeholders", async () => {
    const { fetchImpl, calls } = recordingFetch();
    const client = new ZitadelIdpClient({ ...BASE_CONFIG, fetchImpl });

    await client.createUser({
      email: "participant@example.com",
      credential: "none",
      profile: { givenName: "Иван", familyName: "Петров" },
    });

    const create = calls.find((c) => c.url.endsWith("/v2/users/new"));
    const body = JSON.parse(create?.body ?? "{}") as {
      human: { profile: { [k: string]: string } };
    };
    expect(body.human.profile["givenName"]).toBe("Иван");
    expect(body.human.profile["familyName"]).toBe("Петров");
    // Never the 003 placeholders.
    expect(body.human.profile["familyName"]).not.toBe("guest");
    expect(body.human.profile["displayName"]).toBe("Иван Петров");
  });

  it("EARS-4: when a password-bearing create is made, system shall keep sending the credential (the 003 registration path is untouched)", async () => {
    const { fetchImpl, calls } = recordingFetch();
    const client = new ZitadelIdpClient({ ...BASE_CONFIG, fetchImpl });

    await client.createUser({
      email: "doc@example.com",
      password: "S3cret-passphrase",
    });

    const create = calls.find((c) => c.url.endsWith("/v2/users/new"));
    const body = JSON.parse(create?.body ?? "{}") as {
      human: {
        password?: { password: string };
        profile: { [k: string]: string };
      };
    };
    expect(body.human.password).toEqual({ password: "S3cret-passphrase" });
    expect(body.human.profile["familyName"]).toBe("guest");
  });

  it("EARS-4: when the fake creates a passwordless account, system shall record it as holding no credential (fake/real parity)", async () => {
    const fake = new FakeIdpClient();

    const created = await fake.createUser({
      email: "participant@example.com",
      credential: "none",
      profile: { givenName: "Иван", familyName: "Петров" },
    });
    const withPassword = await fake.createUser({
      email: "doc@example.com",
      password: "S3cret-passphrase",
    });

    expect(fake.hasCredential(created.sub)).toBe(false);
    expect(fake.hasCredential(withPassword.sub)).toBe(true);
  });

  it("EARS-4: when someone tries to sign in with a password to a passwordless account, system shall refuse indistinguishably from an unknown identifier", async () => {
    const fake = new FakeIdpClient();
    await fake.createUser({
      email: "participant@example.com",
      credential: "none",
      profile: { givenName: "Иван", familyName: "Петров" },
    });

    // `passwordLogin` answers an outcome rather than throwing (EARS-16: an
    // unknown identifier and a wrong password are indistinguishable). A
    // credential-less account must land in exactly that same bucket — including
    // for the empty string, which is the credential an "omit the password"
    // implementation would have accidentally created.
    await expect(
      fake.passwordLogin("participant@example.com", ""),
    ).resolves.toEqual({ outcome: "rejected" });
    await expect(
      fake.passwordLogin("participant@example.com", "anything"),
    ).resolves.toEqual({ outcome: "rejected" });
  });
});
