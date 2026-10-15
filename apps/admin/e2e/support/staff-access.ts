import { Redis } from "ioredis";

/**
 * 047 — the stand-side facts the «Доступы» flow spec sets up and reads back,
 * through the same systems the API uses: the IdP management API (Zitadel) for
 * an account's email state and project roles, and the admin session store
 * (Redis) for the age of an operator's second factor.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`E2E requires ${name} in the environment`);
  return value;
}

function idp(): { issuer: string; headers: Record<string, string> } {
  return {
    issuer: required("IDP_ISSUER").replace(/\/$/, ""),
    headers: {
      authorization: `Bearer ${required("IDP_SERVICE_TOKEN")}`,
      "content-type": "application/json",
    },
  };
}

/** The account's IdP subject; the user projection lags a write, so it is polled. */
export async function idpSubOf(email: string): Promise<string> {
  const { issuer, headers } = idp();
  for (let attempt = 0; attempt < 20; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 500));
    const res = await fetch(`${issuer}/management/v1/users/_search`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        queries: [{ emailQuery: { emailAddress: email } }],
      }),
    });
    if (!res.ok) continue;
    const id = ((await res.json()) as { result?: { id: string }[] }).result?.[0]
      ?.id;
    if (id) return id;
  }
  throw new Error(`could not resolve the IdP subject of ${email}`);
}

/**
 * Prove the account's mailbox the way the platform's email-code flows do — a
 * code issued by the IdP and returned to it — so the account is an EXISTING
 * account with a VERIFIED email (047 EARS-4). The IdP returns the code instead
 * of mailing it (`returnCode`), exactly as the API's own `markEmailVerified`.
 */
export async function verifyEmailAtIdp(email: string): Promise<void> {
  const { issuer, headers } = idp();
  const sub = await idpSubOf(email);
  const resend = await fetch(`${issuer}/v2/users/${sub}/email/resend`, {
    method: "POST",
    headers,
    body: JSON.stringify({ returnCode: {} }),
  });
  if (!resend.ok) {
    throw new Error(`IdP email code for ${email}: HTTP ${resend.status}`);
  }
  const { verificationCode } = (await resend.json()) as {
    verificationCode?: string;
  };
  if (!verificationCode) throw new Error(`IdP returned no email code`);
  const verify = await fetch(`${issuer}/v2/users/${sub}/email/verify`, {
    method: "POST",
    headers,
    body: JSON.stringify({ verificationCode }),
  });
  if (!verify.ok) {
    throw new Error(`IdP email verify for ${email}: HTTP ${verify.status}`);
  }
}

/** Whether the IdP holds the account's email as verified. */
export async function idpEmailVerified(email: string): Promise<boolean> {
  const { issuer, headers } = idp();
  const sub = await idpSubOf(email);
  const res = await fetch(`${issuer}/v2/users/${sub}`, { headers });
  if (!res.ok) throw new Error(`IdP user read: HTTP ${res.status}`);
  const body = (await res.json()) as {
    user?: { human?: { email?: { isVerified?: boolean } } };
  };
  return body.user?.human?.email?.isVerified === true;
}

/** The project role keys the account holds at the IdP. */
export async function idpRoleKeysOf(email: string): Promise<string[]> {
  const { issuer, headers } = idp();
  const sub = await idpSubOf(email);
  const projectId = required("IDP_PROJECT_ID");
  const res = await fetch(`${issuer}/management/v1/users/grants/_search`, {
    method: "POST",
    headers,
    body: JSON.stringify({ queries: [{ userIdQuery: { userId: sub } }] }),
  });
  if (!res.ok) throw new Error(`IdP grant search: HTTP ${res.status}`);
  const grants =
    (
      (await res.json()) as {
        result?: { projectId?: string; roleKeys?: string[] }[];
      }
    ).result ?? [];
  return grants
    .filter((grant) => grant.projectId === projectId)
    .flatMap((grant) => grant.roleKeys ?? [])
    .sort();
}

/** The admin session store's key namespaces (`admin-session-store.redis.ts`). */
const ADMIN_SESSION_PREFIX = "ds:admin-session:";
const ADMIN_SESSION_SUB_INDEX_PREFIX = "ds:admin-session:sub:";

/**
 * 047 EARS-8 — make the operator's second factor `ageMs` old: every live admin
 * session of the account gets `mfaVerifiedAtMs = now - ageMs`, the record's TTL
 * kept, exactly the field the step-up guard reads. Thirty-one minutes is the
 * stand-in for an operator who signed in half an hour ago; nothing else of the
 * session changes. Needs the stand's `REDIS_URL` — the api must run on the
 * Redis-backed session store for the guard to read what this writes.
 */
export async function ageAdminSecondFactor(
  email: string,
  ageMs: number,
): Promise<number> {
  const sub = await idpSubOf(email);
  const redis = new Redis(required("REDIS_URL"), { lazyConnect: true });
  await redis.connect();
  try {
    const sids = await redis.smembers(
      `${ADMIN_SESSION_SUB_INDEX_PREFIX}${sub}`,
    );
    let aged = 0;
    for (const sid of sids) {
      const key = `${ADMIN_SESSION_PREFIX}${sid}`;
      const raw = await redis.get(key);
      if (!raw) continue;
      const record = JSON.parse(raw) as Record<string, unknown>;
      await redis.set(
        key,
        JSON.stringify({ ...record, mfaVerifiedAtMs: Date.now() - ageMs }),
        "KEEPTTL",
      );
      aged += 1;
    }
    if (aged === 0) {
      throw new Error(`no live admin session of ${email} in the session store`);
    }
    return aged;
  } finally {
    redis.disconnect();
  }
}
