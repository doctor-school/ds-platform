/**
 * The staging box's converge against the ONE shared Zitadel instance.
 *
 * Two jobs, both whole-set and both idempotent:
 *
 * 1. **Redirect URIs.** §3 «Identity» gives the stand one Zitadel, one project, one
 *    OIDC client, so a slot's `/auth/callback` works only if it is registered on that
 *    shared app. The registration write is WHOLE-SET — a partial list silently
 *    unregisters every other slot (#2064 addendum 2) — so the desired set is always
 *    the whole `renderIdpRedirectUris(registry, baseDomain)` output, unioned with the
 *    URIs `provision.sh` pinned through `IDP_REDIRECT_URIS` / `IDP_POST_LOGOUT_URIS`.
 *
 * 2. **Golden identities.** The five accounts of `packages/db/src/seed/golden/idp.ts`
 *    are the fixture every regression scenario signs in as. `reset-identities`
 *    guarantees their existence, their password and their email-verified state.
 *
 * Shape of every function here: the PLANS are pure (`planRedirectUriConverge`,
 * `planGoldenIdentities`) and the effects arrive injected (`fetch`, `readFile`,
 * `log`), which is what lets the whole file be unit-tested without a Zitadel.
 *
 * Probe → act only when needed → a failing act is a HARD failure. There is no
 * tolerated-failure flag in this file: a redirect set that silently failed to
 * register produces `invalid redirect_uri` at login, which reads as a product bug.
 *
 * The PAT, the golden passwords and the `Authorization` header are NEVER logged and
 * never put into an error message — only presence flags are.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** Every failure this module raises. Never carries a credential in its message. */
export class IdpError extends Error {
  constructor(message) {
    super(message);
    this.name = "IdpError";
  }
}

/** The bootstrap PAT `provision.sh` also authenticates with (root:root 0600). */
export const IDP_PAT_FILE = "/etc/ds-platform/idp-bootstrap-pat.txt";

/**
 * Tool-owned, NON-secret: the five golden subject ids `seed:golden` needs.
 *
 * Subjects are opaque Zitadel ids, not credentials, so they live in their own
 * 0644 file rather than in the root-0700 secret set (`stage.env`) — which keeps
 * `reset-identities` from having to rewrite a secret-bearing file in place
 * (#2064 addendum 5, fork 1). The passwords stay owner-placed in `stage.env`.
 */
export const GOLDEN_SUBJECTS_PATH = "/etc/ds-platform/golden-subjects.env";

/** `provision.sh` defaults — the stage instance reuses the same project/app name. */
export const DEFAULT_PROJECT_NAME = "ds-platform-dev";
export const DEFAULT_APP_NAME = "ds-platform-dev";

/**
 * The golden fixture catalogue, mirroring `packages/db/src/seed/golden/idp.ts`.
 *
 * That TypeScript module is the SSOT of the contract; this file cannot import it,
 * because `tools/staging/*.mjs` is installed to `/opt/ds-platform` as plain ESM with
 * zero workspace dependencies — `packages/db` is not on the box. `idp.test.mjs`
 * therefore reads the TypeScript source and fails on any drift between the two, so
 * the mirror can never quietly diverge from the seed contract it serves.
 */
export const GOLDEN_IDP_ACCOUNTS = Object.freeze([
  Object.freeze({
    key: "doctorUnverified",
    username: "golden.doctor.unverified@example.test",
    emailVerified: false,
    mfaEnrolled: false,
    idpAccountExpected: true,
    subjectEnvVar: "DS_GOLDEN_SUB_DOCTOR_UNVERIFIED",
    passwordEnvVar: "DS_GOLDEN_PASSWORD_DOCTOR_UNVERIFIED",
  }),
  Object.freeze({
    key: "doctorVerified",
    username: "golden.doctor.verified@example.test",
    emailVerified: true,
    mfaEnrolled: false,
    idpAccountExpected: true,
    subjectEnvVar: "DS_GOLDEN_SUB_DOCTOR_VERIFIED",
    passwordEnvVar: "DS_GOLDEN_PASSWORD_DOCTOR_VERIFIED",
  }),
  Object.freeze({
    key: "doctorMfa",
    username: "golden.doctor.mfa@example.test",
    emailVerified: true,
    // MFA enrolment is NOT converged here. `reset-identities` guarantees existence,
    // password and email-verified state only; enrolling the TOTP factor for
    // `doctorMfa` / `admin` belongs to the scenario contract of step 7 (#2067),
    // which is where the challenge is actually driven (#2064 addendum 3 and 5).
    mfaEnrolled: true,
    idpAccountExpected: true,
    subjectEnvVar: "DS_GOLDEN_SUB_DOCTOR_MFA",
    passwordEnvVar: "DS_GOLDEN_PASSWORD_DOCTOR_MFA",
  }),
  Object.freeze({
    key: "doctorDeleted",
    username: "golden.doctor.deleted@example.test",
    emailVerified: true,
    mfaEnrolled: false,
    // No live IdP account may exist for the soft-deleted doctor, yet the seed still
    // needs a stable subject for its NOT NULL `users.zitadel_sub` — hence the
    // synthetic one below (#2064 addendum 5, fork 2).
    idpAccountExpected: false,
    subjectEnvVar: "DS_GOLDEN_SUB_DOCTOR_DELETED",
    passwordEnvVar: "DS_GOLDEN_PASSWORD_DOCTOR_DELETED",
  }),
  Object.freeze({
    key: "admin",
    username: "golden.admin@example.test",
    emailVerified: true,
    mfaEnrolled: true,
    idpAccountExpected: true,
    subjectEnvVar: "DS_GOLDEN_SUB_ADMIN",
    passwordEnvVar: "DS_GOLDEN_PASSWORD_ADMIN",
  }),
]);

/** The five `DS_GOLDEN_SUB_*` names, in catalogue order. */
export const GOLDEN_SUBJECT_ENV_VARS = Object.freeze(
  GOLDEN_IDP_ACCOUNTS.map((account) => account.subjectEnvVar),
);

/** The five `DS_GOLDEN_PASSWORD_*` names, in catalogue order. */
export const GOLDEN_PASSWORD_ENV_VARS = Object.freeze(
  GOLDEN_IDP_ACCOUNTS.filter((account) => account.idpAccountExpected).map(
    (account) => account.passwordEnvVar,
  ),
);

// --- pure plans --------------------------------------------------------------

/**
 * The soft-deleted doctor's synthetic subject.
 *
 * Deterministic (same username ⇒ same subject on every run, on every box) and
 * unmistakable: the `golden-deleted-` marker means a human reading `users.zitadel_sub`
 * knows no Zitadel account backs it, and the shape can never collide with a real
 * Zitadel id (those are decimal snowflakes).
 */
export function goldenDeletedSubject(username) {
  const digest = createHash("sha256").update(String(username)).digest("hex");
  return `golden-deleted-${digest.slice(0, 32)}`;
}

/** `a ∪ b`, order preserved, duplicates dropped — the whole-set union. */
export function unionUris(pinned, rendered) {
  return [...new Set([...(pinned ?? []), ...(rendered ?? [])])].filter(Boolean);
}

const sameSet = (a, b) => {
  const left = [...new Set(a ?? [])].sort();
  const right = [...new Set(b ?? [])].sort();
  return left.length === right.length && left.every((value, i) => value === right[i]);
};

/**
 * The OIDC app config the converge writes, minus `name`.
 *
 * Byte-for-byte the payload `infra/dev-stand/idp/provision.sh` builds (:291-309), so
 * a converge from either side leaves the app in the same state. `name` is stripped
 * exactly as `provision.sh` strips it on the update path: it belongs to the app
 * resource, not to its `oidc_config` sub-resource.
 */
function oidcConfigBody({ redirectUris, postLogoutRedirectUris }) {
  return {
    redirectUris,
    postLogoutRedirectUris,
    responseTypes: ["OIDC_RESPONSE_TYPE_CODE"],
    grantTypes: ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE", "OIDC_GRANT_TYPE_REFRESH_TOKEN"],
    appType: "OIDC_APP_TYPE_WEB",
    authMethodType: "OIDC_AUTH_METHOD_TYPE_BASIC",
    version: "OIDC_VERSION_1_0",
    devMode: true,
    accessTokenType: "OIDC_TOKEN_TYPE_JWT",
    accessTokenRoleAssertion: true,
    idTokenRoleAssertion: true,
    idTokenUserinfoAssertion: true,
  };
}

/**
 * ensure-present for the WHOLE redirect set: `{ action: "skip" }` when the app
 * already carries exactly it, `{ action: "put", body }` otherwise.
 *
 * The compare is order-insensitive (Zitadel does not promise to echo the order it was
 * given) while the write sends the ordered set, so a converge is stable: a second run
 * over the same registry skips instead of PUTting the same list forever.
 */
export function planRedirectUriConverge({ current, desired }) {
  const redirectUris = [...(desired?.redirectUris ?? [])];
  const postLogoutRedirectUris = [...(desired?.postLogoutUris ?? desired?.postLogoutRedirectUris ?? [])];
  if (
    sameSet(current?.redirectUris, redirectUris) &&
    sameSet(current?.postLogoutRedirectUris, postLogoutRedirectUris)
  ) {
    return { action: "skip" };
  }
  return { action: "put", body: oidcConfigBody({ redirectUris, postLogoutRedirectUris }) };
}

/**
 * The ordered converge steps for the golden fixture, plus the subject map.
 *
 * `existing` maps username → `{ userId, emailVerified }` for the accounts the IdP
 * currently holds (absent ⇒ no entry). Membership decides the verb:
 *
 * - `idpAccountExpected: true` — ensure-PRESENT. Created when absent; the password is
 *   set on EVERY run (the fixture's password is an input of the scenario runner, and a
 *   drifted one is indistinguishable from a broken login), and the email-verified
 *   state is converged.
 * - `idpAccountExpected: false` — ensure-ABSENT. Deleted only when a live account
 *   carries the username; never created.
 *
 * The one asymmetry: Zitadel has no «un-verify» verb, so an account that is verified
 * while the fixture demands an UNverified one is rebuilt (delete, then create with the
 * flag off) rather than left in a state the fixture does not describe.
 */
export function planGoldenIdentities({ accounts, existing }) {
  const steps = [];
  const subjects = {};
  for (const account of accounts ?? []) {
    const live = existing?.[account.username];
    if (!account.idpAccountExpected) {
      subjects[account.subjectEnvVar] = goldenDeletedSubject(account.username);
      if (live?.userId) {
        steps.push({
          op: "delete",
          username: account.username,
          userId: live.userId,
          key: account.key,
        });
      }
      continue;
    }
    const mustRebuild = Boolean(live) && live.emailVerified === true && !account.emailVerified;
    if (live?.userId && !mustRebuild) {
      subjects[account.subjectEnvVar] = live.userId;
      steps.push({
        op: "set-password",
        username: account.username,
        userId: live.userId,
        key: account.key,
        passwordEnvVar: account.passwordEnvVar,
      });
      if (account.emailVerified && !live.emailVerified) {
        steps.push({
          op: "verify-email",
          username: account.username,
          userId: live.userId,
          key: account.key,
        });
      }
      continue;
    }
    if (mustRebuild) {
      steps.push({
        op: "delete",
        username: account.username,
        userId: live.userId,
        key: account.key,
      });
    }
    steps.push({
      op: "create",
      username: account.username,
      key: account.key,
      emailVerified: account.emailVerified,
      subjectEnvVar: account.subjectEnvVar,
      passwordEnvVar: account.passwordEnvVar,
    });
    // The password is set as its own step even though `create` carries one: the
    // create path and the converged path must leave exactly the same state, and a
    // single «set password» verb is one place to get that wrong instead of two.
    steps.push({
      op: "set-password",
      username: account.username,
      userId: null,
      key: account.key,
      passwordEnvVar: account.passwordEnvVar,
    });
  }
  return { steps, subjects };
}

// --- the tool-owned subjects file --------------------------------------------

/** The 0644 file `reset-identities` writes and `renderSlotEnv` merges. */
export function renderGoldenSubjectsEnv(subjects) {
  const lines = [
    "# generated by tools/staging/idp.mjs (`ds-slot reset-identities`) — do not edit by hand",
    "# Opaque Zitadel subject ids, NOT secrets. The golden PASSWORDS live in",
    "# /etc/ds-platform/stage.env and stay owner-placed (#2064 addendum 5).",
  ];
  for (const name of GOLDEN_SUBJECT_ENV_VARS) {
    const value = subjects?.[name];
    if (!value) throw new IdpError(`golden subject ${name} is missing — refusing to write a blank`);
    lines.push(`${name}=${value}`);
  }
  lines.push("");
  return lines.join("\n");
}

/** The same file, read back. Unknown names are ignored; the five are required. */
export function parseGoldenSubjectsEnv(text) {
  const subjects = {};
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    if (GOLDEN_SUBJECT_ENV_VARS.includes(match[1])) subjects[match[1]] = match[2];
  }
  const missing = GOLDEN_SUBJECT_ENV_VARS.filter((name) => !subjects[name]);
  if (missing.length) {
    throw new IdpError(
      `${GOLDEN_SUBJECTS_PATH} is missing ${missing.join(", ")} — run \`ds-slot reset-identities <slot>\` first`,
    );
  }
  return subjects;
}

/**
 * The subjects as they are on disk, or a refusal naming the command that writes them.
 *
 * Fail-closed on purpose: a slot env rendered with BLANK `DS_GOLDEN_SUB_*` would let
 * `slot up` run all the way to `seed:golden`, which then aborts inside a container
 * with a message about environment variables nobody set — the refusal has to name
 * `ds-slot reset-identities` at the point the operator can act on it.
 */
export function readGoldenSubjects({ readFile = readFileSync, path = GOLDEN_SUBJECTS_PATH } = {}) {
  let text;
  try {
    text = readFile(path, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") {
      throw new IdpError(
        `${path} does not exist — run \`ds-slot reset-identities <slot>\` once before bringing a slot up`,
      );
    }
    throw err;
  }
  return parseGoldenSubjectsEnv(text);
}

// --- the Zitadel client (injected `fetch`) -----------------------------------

/**
 * The smallest possible Zitadel client: one `request` verb over an injected `fetch`.
 *
 * Mirrors `provision.sh`'s `api()` helper — bearer PAT, JSON content type, the path
 * appended raw to the origin so `/management/v1/...`, `/auth/v1/...` and `/v2/...`
 * hang off the same base URL. A non-2xx is an IdpError carrying the method, the path
 * and the status — never the token, never a request body (which may hold a password).
 */
export function createIdpClient({ fetch: fetchImpl, baseUrl, pat }) {
  if (typeof fetchImpl !== "function") throw new IdpError("createIdpClient needs a `fetch`");
  if (!baseUrl) throw new IdpError("createIdpClient needs a base URL (IDP_BASE_URL)");
  if (!pat) throw new IdpError(`createIdpClient needs the bootstrap PAT (${IDP_PAT_FILE})`);
  const origin = String(baseUrl).replace(/\/$/, "");
  return {
    origin,
    async request(method, path, body) {
      let res;
      try {
        res = await fetchImpl(`${origin}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${pat}`,
            "Content-Type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch (err) {
        throw new IdpError(
          `${method} ${path} could not reach the IdP at ${origin}: ${err?.message ?? err}`,
        );
      }
      if (!res.ok) {
        throw new IdpError(`${method} ${path} answered ${res.status} (IdP at ${origin})`);
      }
      return await res.json();
    },
  };
}

// --- redirect-URI converge ---------------------------------------------------

async function resolveSharedApp(client, { projectName, appName }) {
  const projects = await client.request("POST", "/management/v1/projects/_search", {
    queries: [{ nameQuery: { name: projectName, method: "TEXT_QUERY_METHOD_EQUALS" } }],
  });
  const projectId = (projects?.result ?? []).find((item) => item.name === projectName)?.id;
  if (!projectId) {
    throw new IdpError(
      `the shared project "${projectName}" does not exist on this IdP — this tool CONVERGES ` +
        "the stand's app, it never bootstraps it; run infra/dev-stand/idp/provision.sh first",
    );
  }
  const apps = await client.request(
    "POST",
    `/management/v1/projects/${projectId}/apps/_search`,
    { queries: [{ nameQuery: { name: appName, method: "TEXT_QUERY_METHOD_EQUALS" } }] },
  );
  const appId = (apps?.result ?? []).find((item) => item.name === appName)?.id;
  if (!appId) {
    throw new IdpError(
      `the shared OIDC app "${appName}" does not exist in project "${projectName}" — run ` +
        "infra/dev-stand/idp/provision.sh first (this tool never creates the app)",
    );
  }
  return { projectId, appId };
}

/**
 * Converge the WHOLE redirect + post-logout set onto the shared OIDC app.
 *
 * Probe (`GET .../apps/{id}`) → PUT only on a difference → any failure of either hop
 * aborts. A slot whose callback is not registered fails login with `invalid
 * redirect_uri`, which is strictly worse than a refused `slot up`.
 */
export async function convergeRedirectUris({
  client,
  desired,
  projectName = DEFAULT_PROJECT_NAME,
  appName = DEFAULT_APP_NAME,
  log = () => {},
}) {
  const { projectId, appId } = await resolveSharedApp(client, { projectName, appName });
  const detail = await client.request("GET", `/management/v1/projects/${projectId}/apps/${appId}`);
  const current = detail?.app?.oidcConfig ?? {};
  const plan = planRedirectUriConverge({ current, desired });
  if (plan.action === "skip") {
    log(`  ↳ idp redirect set already holds ${current.redirectUris?.length ?? 0} URI(s)`);
    return { action: "skip", projectId, appId };
  }
  await client.request(
    "PUT",
    `/management/v1/projects/${projectId}/apps/${appId}/oidc_config`,
    plan.body,
  );
  log(
    `  ↳ idp redirect set converged: ${plan.body.redirectUris.length} redirect, ` +
      `${plan.body.postLogoutRedirectUris.length} post-logout URI(s)`,
  );
  return { action: "put", projectId, appId, body: plan.body };
}

// --- golden identity converge ------------------------------------------------

/** User v2 search by email — the shape `apps/api`'s Zitadel client also uses. */
async function findUserByUsername(client, username) {
  const data = await client.request("POST", "/v2/users", {
    queries: [{ emailQuery: { emailAddress: username } }],
  });
  const hit = (data?.result ?? [])[0];
  if (!hit?.userId) return null;
  return {
    userId: hit.userId,
    emailVerified: Boolean(hit.human?.email?.isVerified),
  };
}

/**
 * The organisation a created user lands in.
 *
 * `POST /v2/users/new` requires `organizationId` explicitly — it does not infer the
 * org from the token the way the retired `AddHumanUser` did. `IDP_ORG_ID` wins when
 * the box pins one; otherwise it is the PAT machine user's own org, which is the org
 * `provision.sh` provisioned the project into.
 */
async function resolveOrgId(client, env) {
  if (env?.IDP_ORG_ID) return env.IDP_ORG_ID;
  const me = await client.request("GET", "/auth/v1/users/me");
  const orgId = me?.user?.details?.resourceOwner ?? me?.user?.resourceOwner;
  if (!orgId) {
    throw new IdpError(
      "could not resolve the IdP organisation for a golden account create — set IDP_ORG_ID " +
        "in /etc/ds-platform/stage.env",
    );
  }
  return orgId;
}

/**
 * Converge the golden fixture at the IdP and return the resolved subject map.
 *
 * Hard-failure everywhere: every create, password write, verification and delete that
 * actually runs must succeed. The only «nothing to do» outcomes are membership facts
 * (already present / already absent), never a swallowed error.
 *
 * What is deliberately NOT converged: the TOTP enrolment of `doctorMfa` and `admin`.
 * That belongs to the scenario contract of step 7 (#2067) — see the catalogue above.
 */
export async function convergeGoldenIdentities({
  client,
  accounts = GOLDEN_IDP_ACCOUNTS,
  passwords = {},
  env = {},
  log = () => {},
}) {
  // Fail BEFORE the first write: a converge that creates two accounts and then dies
  // on a missing password leaves a half-built fixture behind.
  const missing = accounts
    .filter((account) => account.idpAccountExpected)
    .map((account) => account.passwordEnvVar)
    .filter((name) => !passwords[name]);
  if (missing.length) {
    throw new IdpError(
      `missing golden password(s): ${missing.join(", ")} — they are owner-placed in ` +
        "/etc/ds-platform/stage.env (see infra/deploy/stage.env.example)",
    );
  }

  const existing = {};
  for (const account of accounts) {
    const live = await findUserByUsername(client, account.username);
    if (live) existing[account.username] = live;
  }

  const { steps, subjects } = planGoldenIdentities({ accounts, existing });
  const byKey = new Map(accounts.map((account) => [account.key, account]));
  let orgId;
  for (const step of steps) {
    const account = byKey.get(step.key);
    if (step.op === "delete") {
      await client.request("DELETE", `/v2/users/${step.userId}`);
      delete existing[step.username];
      log(`  ↳ removed the live account for ${step.username}`);
    } else if (step.op === "create") {
      orgId ??= await resolveOrgId(client, env);
      const created = await client.request("POST", "/v2/users/new", {
        organizationId: orgId,
        username: account.username,
        human: {
          profile: { givenName: "Golden", familyName: account.key },
          // `returnCode: {}` keeps Zitadel from mailing a verification code the
          // fixture nobody reads would receive; `isVerified` sets the flag outright.
          email: account.emailVerified
            ? { email: account.username, isVerified: true }
            : { email: account.username, returnCode: {} },
        },
      });
      const userId = created?.userId;
      if (!userId) throw new IdpError(`creating ${step.username} returned no userId`);
      existing[step.username] = { userId, emailVerified: account.emailVerified };
      subjects[account.subjectEnvVar] = userId;
      log(`  ↳ created ${step.username} (verified: ${account.emailVerified})`);
    } else if (step.op === "set-password") {
      const userId = step.userId ?? existing[step.username]?.userId;
      if (!userId) throw new IdpError(`no user id to set the password of ${step.username} on`);
      await client.request("POST", `/v2/users/${userId}/password`, {
        newPassword: { password: passwords[step.passwordEnvVar], changeRequired: false },
      });
      log(`  ↳ password set for ${step.username} (from ${step.passwordEnvVar})`);
    } else if (step.op === "verify-email") {
      // The two-hop flip proven live in #1131: SetEmail with `isVerified` is rejected
      // for an unchanged address, so a fresh code is returned (never delivered) and
      // immediately verified. The code lives in this local only — never logged.
      const issued = await client.request("POST", `/v2/users/${step.userId}/email/resend`, {
        returnCode: {},
      });
      const code = issued?.verificationCode ?? issued?.emailCode;
      if (!code) throw new IdpError(`the IdP returned no verification code for ${step.username}`);
      await client.request("POST", `/v2/users/${step.userId}/email/verify`, {
        verificationCode: code,
      });
      existing[step.username].emailVerified = true;
      log(`  ↳ email marked verified for ${step.username}`);
    } else {
      throw new IdpError(`unknown golden identity step: ${step.op}`);
    }
  }

  for (const account of accounts) {
    if (subjects[account.subjectEnvVar]) continue;
    const userId = existing[account.username]?.userId;
    if (!userId) throw new IdpError(`no subject resolved for ${account.subjectEnvVar}`);
    subjects[account.subjectEnvVar] = userId;
  }
  return subjects;
}
