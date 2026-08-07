import { beforeAll, describe, expect, it } from "vitest";

// 011 EARS-8 — Zitadel TOTP as PROVISIONED configuration, not a console click.
//
// This suite asserts the posture that `infra/dev-stand/idp/provision.sh` step 9
// converges on the instance's DEFAULT login policy, read back over the live IdP
// Admin API. It is the executable half of Verification row 8: a freshly
// provisioned stand must be MFA-capable with no hand steps.
//
// Why the assertions are configuration-level and not a browser login: EARS-8
// ships the IdP *capability* only. The MFA *mandate* is our backend's
// `role -> mfa_required` policy (EARS-3), deliberately NOT the org-wide
// `forceMfa` switch — Zitadel login policies are organisation-scoped, so
// `forceMfa` would impose TOTP on every `doctor_guest` (Constraints). The
// "a doctor_guest login is unaffected" half of row 8 is therefore asserted where
// this change could break it: the switches that pull a principal into an MFA
// step (`forceMfa` / `forceMfaLocalOnly`) stay off, password login stays
// allowed, and the pre-existing second-factor set is added to, never replaced.
// The doctor login path itself is exercised end-to-end by the shipped 003 auth
// suites, which run unchanged against this same stand.
//
// Env-gated per the spec's Dependencies note: endpoints and credentials come
// from `~/.ds-platform/.env.local` / the process env, never a literal (the
// recipe HOST differs per developer). Absent env (CI) skips.
const ISSUER = process.env.IDP_ISSUER?.replace(/\/$/, "");
const TOKEN = process.env.IDP_SERVICE_TOKEN;

// The provisioned contract. These literals are the SSOT mirror of the
// `MFA_*_LIFETIME` constants in `infra/dev-stand/idp/provision.sh` step 9 and of
// the prod-parity obligation recorded in `tools/deploy/README.md`; a drift in
// either direction fails here. Zitadel serialises `google.protobuf.Duration` as
// a protojson second-string, which is the form asserted.
const EXPECTED_LIFETIMES = {
  // A skip of the IdP's own MFA-setup prompt survives at most a minute, so it
  // cannot carry from one login into the next. Deliberately NOT `0s`: in
  // Zitadel's auth-request logic a zero `mfaInitSkipLifetime` means "never
  // prompt for setup at all", which is the opposite of "cannot be skipped".
  mfaInitSkipLifetime: "60s",
  // Long enough to complete one login flow, far shorter than any plausible gap
  // between two logins — so a satisfied factor check never survives across
  // logins. The Zitadel defaults this replaces are 18 h / 12 h, which do.
  secondFactorCheckLifetime: "300s",
  multiFactorCheckLifetime: "300s",
} as const;

type LoginPolicy = {
  allowUsernamePassword?: boolean;
  allowRegister?: boolean;
  forceMfa?: boolean;
  forceMfaLocalOnly?: boolean;
  mfaInitSkipLifetime?: string;
  secondFactorCheckLifetime?: string;
  multiFactorCheckLifetime?: string;
  secondFactors?: string[];
};

async function adminGet<T>(path: string): Promise<T> {
  const res = await fetch(`${ISSUER}${path}`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok)
    throw new Error(`IdP admin GET ${path} -> ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

describe.skipIf(!ISSUER || !TOKEN)(
  "011 EARS-8: IdP MFA capability is provisioned configuration (e2e, live IdP)",
  () => {
    let policy: LoginPolicy;
    let secondFactors: string[];

    beforeAll(async () => {
      policy = (
        await adminGet<{ policy: LoginPolicy }>("/admin/v1/policies/login")
      ).policy;
      // The second-factor list is not part of the login-policy read message; it
      // rides its own list endpoint (a POST `_search`, not a GET).
      const res = await fetch(
        `${ISSUER}/admin/v1/policies/login/second_factors/_search`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${TOKEN}`,
            "content-type": "application/json",
          },
          body: "{}",
        },
      );
      if (!res.ok)
        throw new Error(`IdP admin second-factor search -> ${res.status}`);
      secondFactors =
        ((await res.json()) as { result?: string[] }).result ?? [];
    });

    it("EARS-8: TOTP is registered as an allowed second factor on the login policy", () => {
      expect(secondFactors).toContain("SECOND_FACTOR_TYPE_OTP");
    });

    it("EARS-8: the factor-check and MFA-init-skip lifetimes are the provisioned values", () => {
      expect({
        mfaInitSkipLifetime: policy.mfaInitSkipLifetime,
        secondFactorCheckLifetime: policy.secondFactorCheckLifetime,
        multiFactorCheckLifetime: policy.multiFactorCheckLifetime,
      }).toEqual(EXPECTED_LIFETIMES);
    });

    it("EARS-8: the org-wide forceMfa switch is OFF — the mandate is the role policy, not the IdP", () => {
      expect(policy.forceMfa ?? false).toBe(false);
      expect(policy.forceMfaLocalOnly ?? false).toBe(false);
    });

    it("EARS-8: a doctor_guest login flow is unaffected — password login open, no factor removed, register still closed", () => {
      // Nothing in this provisioning pulls a non-admin principal into an MFA
      // step or narrows the primary-auth path...
      expect(policy.allowUsernamePassword ?? false).toBe(true);
      // ...the second-factor registration is additive — U2F, which the instance
      // ships enabled, is still there...
      expect(secondFactors).toContain("SECOND_FACTOR_TYPE_U2F");
      // ...and the #877 closed-register posture is not collaterally reopened by
      // this login-policy read-modify-write.
      expect(policy.allowRegister ?? false).toBe(false);
    });
  },
);
