/**
 * Minimal Zitadel service-API helper for the portal SMS-OTP journey (#170).
 *
 * The portal's register form (EARS-1/2) collects only email + password — there is
 * no phone field in the UI (a phone-registration surface is a separate product
 * slice). But the SMS-OTP login journey (EARS-7) needs an account that already
 * carries a VERIFIED phone. So, exactly as the api-tier e2e creates its fixtures
 * directly against Zitadel rather than through a UI it does not own, this helper
 * provisions the account out-of-band via the Zitadel v2 service API (the same
 * `IDP_SERVICE_TOKEN` the BFF uses). This is fixture setup, NOT the code path
 * under test — the journey under test is the live BROWSER round-trip on /login.
 *
 * Gated by the suite's LIVE_OIDC check (IDP_ISSUER + IDP_SERVICE_TOKEN present).
 */

const base = (): string => process.env.IDP_ISSUER!.replace(/\/$/, "");
const headers = (): Record<string, string> => ({
  authorization: `Bearer ${process.env.IDP_SERVICE_TOKEN!}`,
  "content-type": "application/json",
});

/** Create a human user with email+password+phone. Returns the Zitadel userId. */
export async function createUserWithPhone(input: {
  email: string;
  password: string;
  phone: string;
}): Promise<string> {
  // `returnCode: {}` on email+phone suppresses Zitadel's auto-send (mirrors the
  // BFF's createUser, src/auth/idp/zitadel.idp.ts) so the only SMS we read for
  // verify is the deliberate `phone/resend` below.
  const res = await fetch(`${base()}/v2/users/human`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      profile: {
        givenName: input.email.split("@")[0] ?? "doctor",
        familyName: "guest",
      },
      password: { password: input.password },
      email: { email: input.email, returnCode: {} },
      phone: { phone: input.phone, returnCode: {} },
    }),
  });
  if (!res.ok) {
    throw new Error(
      `createUserWithPhone failed: HTTP ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as { userId?: string };
  if (!data.userId)
    throw new Error("createUserWithPhone: no userId in response");
  return data.userId;
}

/** Send a phone-verification SMS (delivered to the sink) — `POST .../phone/resend`. */
export async function requestPhoneVerification(userId: string): Promise<void> {
  const res = await fetch(`${base()}/v2/users/${userId}/phone/resend`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ sendCode: {} }),
  });
  if (!res.ok) {
    throw new Error(`requestPhoneVerification failed: HTTP ${res.status}`);
  }
}

/** Verify the phone with the delivered code — `POST .../phone/verify`. */
export async function verifyPhone(userId: string, code: string): Promise<void> {
  const res = await fetch(`${base()}/v2/users/${userId}/phone/verify`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ verificationCode: code }),
  });
  if (!res.ok) {
    throw new Error(`verifyPhone failed: HTTP ${res.status}`);
  }
}

/**
 * Grant the `doctor_guest` project role to `userId` — `POST /management/v1/users/
 * {sub}/grants` `{ projectId, roleKeys }` (the #157 grant the BFF register flow
 * performs). Without it the OIDC token's `urn:zitadel:iam:org:project:roles` claim
 * is empty and the `doctor_guest`-gated `/auth/session` read 403s, so a session
 * established by SMS-OTP login would look "lost" on the /account landing. Since
 * this journey provisions the user out-of-band (the portal register form has no
 * phone field), it must replicate the register-time grant. Needs IDP_PROJECT_ID.
 * Idempotent: Zitadel returns 409 ALREADY_EXISTS, which we treat as converged.
 */
export async function grantDoctorGuest(userId: string): Promise<void> {
  const projectId = process.env.IDP_PROJECT_ID;
  if (!projectId) {
    throw new Error(
      "grantDoctorGuest needs IDP_PROJECT_ID (the ds-platform-dev project owning doctor_guest)",
    );
  }
  const res = await fetch(`${base()}/management/v1/users/${userId}/grants`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ projectId, roleKeys: ["doctor_guest"] }),
  });
  if (!res.ok && res.status !== 409) {
    throw new Error(
      `grantDoctorGuest failed: HTTP ${res.status} ${await res.text()}`,
    );
  }
}

/** Delete the user by id (teardown — avoids the FakeIdpClient zitadel_sub clash). */
export async function deleteUser(userId: string): Promise<void> {
  await fetch(`${base()}/v2/users/${userId}`, {
    method: "DELETE",
    headers: headers(),
  }).catch(() => {
    /* best-effort; the reconciliation sweep tolerates leftovers */
  });
}
