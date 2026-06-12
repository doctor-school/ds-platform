import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZitadelIdpClient } from "../../src/auth/idp/zitadel.idp.js";

/**
 * EARS-1/2 real-adapter integration spec (design §2, §4 — the registration
 * cascade's first IdP hop): `createUser` against a **running** Zitadel v4.
 *
 * This pins the live wire shape of the resource API `CreateUser`
 * (`POST /v2/users/new`, #203 — which REPLACES the deprecated `AddHumanUser`
 * `POST /v2/users/human`) that the FakeIdpClient masks — Zitadel requires a
 * `human.profile` object (`givenName`/`familyName`) and an explicit
 * `organizationId` on creation (the adapter resolves the latter from the service
 * account's own org when `IDP_ORG_ID` is unset), and the default password policy
 * requires an upper-case character. All are invisible to the unit spec
 * (`src/auth/idp/zitadel.idp.spec.ts`, scripted fetch) and to every auth e2e
 * (which overrides `IDP_CLIENT` with the fake). #145/#203.
 *
 * Gated on the live-IdP env (`IDP_ISSUER` + `IDP_SERVICE_TOKEN`), mirroring the
 * F1/F2 real-adapter pattern — it SKIPS in the shared CI `api-e2e` job (which
 * sets only `DATABASE_URL`; `IDP_ISSUER` is not in turbo `passThroughEnv`) and
 * runs only against a provisioned dev-stand.
 *
 * Per the e2e convention, this spec deletes its own users by email on teardown
 * (FakeIdpClient's deterministic fake-sub collides on `users.zitadel_sub`
 * otherwise — and a real Zitadel rejects a duplicate email with 409, which is
 * the enumeration hinge we explicitly exercise).
 */
const LIVE_IDP = !!process.env.IDP_ISSUER && !!process.env.IDP_SERVICE_TOKEN;

/**
 * Mints a password that satisfies the `@ds/schemas` creation baseline
 * (`NewPassword`: ≥8 + upper + lower + digit + symbol) — which since #147 mirrors
 * the live Zitadel default complexity policy, so the same fixture clears both the
 * BFF contract and the IdP. Zitadel remains the ultimate authority and may be
 * configured stricter (`auth.schema.ts`).
 */
function livePassword(): string {
  return `Int-${Date.now()}-aA1!`;
}

describe.skipIf(!LIVE_IDP)("Zitadel createUser (integration)", () => {
  let client: ZitadelIdpClient;
  const createdEmails: string[] = [];

  const newEmail = (): string => {
    const email = `int-145-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}@ds.test`;
    createdEmails.push(email);
    return email;
  };

  beforeAll(() => {
    client = new ZitadelIdpClient({
      baseUrl: process.env.IDP_ISSUER!,
      serviceToken: process.env.IDP_SERVICE_TOKEN!,
    });
  });

  afterAll(async () => {
    // Clean up live test users by email (e2e convention) so reruns and the
    // FakeIdpClient-backed suites do not collide on the mirror's zitadel_sub.
    const base = process.env.IDP_ISSUER!.replace(/\/$/, "");
    const headers = {
      authorization: `Bearer ${process.env.IDP_SERVICE_TOKEN!}`,
      "content-type": "application/json",
    };
    for (const email of createdEmails) {
      try {
        const search = await fetch(`${base}/v2/users`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            queries: [{ emailQuery: { emailAddress: email } }],
          }),
        });
        if (!search.ok) continue;
        const data = (await search.json()) as {
          result?: Array<{ userId?: string }>;
        };
        const userId = data.result?.[0]?.userId;
        if (userId) {
          await fetch(`${base}/v2/users/${userId}`, {
            method: "DELETE",
            headers,
          });
        }
      } catch {
        // Best-effort; the reconciliation sweep tolerates leftover users.
      }
    }
  });

  it("EARS-1: creates a human user against real Zitadel (profile + policy-valid password)", async () => {
    const email = newEmail();
    const created = await client.createUser({
      email,
      password: livePassword(),
    });
    expect(created.alreadyExisted).toBe(false);
    expect(created.sub).toBeTruthy();
  });

  it("EARS-1/16: a duplicate identifier resolves to alreadyExisted (enumeration hinge), not a throw", async () => {
    const email = newEmail();
    const password = livePassword();
    const first = await client.createUser({ email, password });
    expect(first.alreadyExisted).toBe(false);

    const second = await client.createUser({ email, password });
    expect(second.alreadyExisted).toBe(true);
  });
});
