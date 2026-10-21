/**
 * The staging box's converge against the ONE shared Zitadel instance.
 *
 * Three jobs, all idempotent:
 *
 * 1. **Redirect URIs.** §3 «Identity» gives the stand one Zitadel, one project, one
 *    OIDC client, so a slot's `/auth/callback` works only if it is registered on that
 *    shared app. The registration write is WHOLE-SET — a partial list silently
 *    unregisters every other slot (#2064 addendum 2) — so the desired set is always
 *    the whole `renderIdpRedirectUris(registry, baseDomain)` output, unioned with the
 *    URIs `provision.sh` pinned through `IDP_REDIRECT_URIS` / `IDP_POST_LOGOUT_URIS`.
 *
 * 2. **Golden identities.** The accounts (five named + the #2805 worker pool) of `packages/db/src/seed/golden/idp.ts`
 *    are the fixture every regression scenario signs in as. `reset-identities`
 *    guarantees their existence, their password and their email-verified state.
 *
 * 3. **The agent admin** (#2531). A stage-only admin outside the golden catalogue whose
 *    password and TOTP factor this file converges, so an agent can pass the admin's
 *    second-factor challenge on a slot without the owner's authenticator.
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
import { createHash, createHmac, randomBytes } from "node:crypto";
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
 * Tool-owned, NON-secret: every golden subject id `seed:golden` needs.
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
 * because `tools/staging/*.mjs` runs as plain ESM with zero workspace dependencies
 * (`node tools/staging/idp.mjs`, no build step) — `packages/db` is not importable here. `idp.test.mjs`
 * therefore reads the TypeScript source and fails on any drift between the two, so
 * the mirror can never quietly diverge from the seed contract it serves.
 */
// `role` is mirrored too: `idp.test.mjs` compares the whole catalogue field by field
// against packages/db/src/seed/golden/idp.ts, and a field that is not mirrored is a
// field the drift test cannot see (#2064 addendum 6 §1).
export const GOLDEN_IDP_ACCOUNTS = Object.freeze([
  Object.freeze({
    key: "doctorUnverified",
    username: "golden.doctor.unverified@example.test",
    role: "doctor_guest",
    roleKeys: ["doctor_guest"],
    emailVerified: false,
    mfaEnrolled: false,
    idpAccountExpected: true,
    subjectEnvVar: "DS_GOLDEN_SUB_DOCTOR_UNVERIFIED",
    passwordEnvVar: "DS_GOLDEN_PASSWORD_DOCTOR_UNVERIFIED",
  }),
  Object.freeze({
    key: "doctorVerified",
    username: "golden.doctor.verified@example.test",
    role: "doctor_guest",
    roleKeys: ["doctor_guest"],
    emailVerified: true,
    mfaEnrolled: false,
    idpAccountExpected: true,
    subjectEnvVar: "DS_GOLDEN_SUB_DOCTOR_VERIFIED",
    passwordEnvVar: "DS_GOLDEN_PASSWORD_DOCTOR_VERIFIED",
  }),
  Object.freeze({
    key: "doctorMfa",
    username: "golden.doctor.mfa@example.test",
    role: "doctor_guest",
    roleKeys: ["doctor_guest"],
    emailVerified: true,
    // MFA enrolment is NOT converged here: the `doctorMfa` / `admin` factors are
    // enrolled in the owner's authenticator and `reset-identities` guarantees only
    // existence, password and email-verified state. The account agents pass a TOTP
    // challenge with is `STAGE_AGENT_ADMIN` below, whose factor IS converged (#2531).
    mfaEnrolled: true,
    idpAccountExpected: true,
    subjectEnvVar: "DS_GOLDEN_SUB_DOCTOR_MFA",
    passwordEnvVar: "DS_GOLDEN_PASSWORD_DOCTOR_MFA",
  }),
  Object.freeze({
    key: "doctorDeleted",
    username: "golden.doctor.deleted@example.test",
    role: "doctor_guest",
    roleKeys: ["doctor_guest"],
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
    role: "platform_admin",
    // #2456: staff are users too — the visitor role plus the admin rights on top.
    roleKeys: ["doctor_guest", "platform_admin"],
    emailVerified: true,
    mfaEnrolled: true,
    idpAccountExpected: true,
    subjectEnvVar: "DS_GOLDEN_SUB_ADMIN",
    passwordEnvVar: "DS_GOLDEN_PASSWORD_ADMIN",
  }),
  // #2805 — the worker pool of `doctorVerified` (`GOLDEN_WORKER_POOL_SIZE` in
  // `ids.ts`): one account per parallel Playwright worker beyond worker 0. Each
  // shares the verified doctor's PASSWORD env var — no new secret — and has its
  // own subject.
  Object.freeze({
    key: "doctorVerifiedW1",
    username: "golden.doctor.verified.w1@example.test",
    role: "doctor_guest",
    roleKeys: ["doctor_guest"],
    emailVerified: true,
    mfaEnrolled: false,
    idpAccountExpected: true,
    subjectEnvVar: "DS_GOLDEN_SUB_DOCTOR_VERIFIED_W1",
    passwordEnvVar: "DS_GOLDEN_PASSWORD_DOCTOR_VERIFIED",
  }),
  Object.freeze({
    key: "doctorVerifiedW2",
    username: "golden.doctor.verified.w2@example.test",
    role: "doctor_guest",
    roleKeys: ["doctor_guest"],
    emailVerified: true,
    mfaEnrolled: false,
    idpAccountExpected: true,
    subjectEnvVar: "DS_GOLDEN_SUB_DOCTOR_VERIFIED_W2",
    passwordEnvVar: "DS_GOLDEN_PASSWORD_DOCTOR_VERIFIED",
  }),
  Object.freeze({
    key: "doctorVerifiedW3",
    username: "golden.doctor.verified.w3@example.test",
    role: "doctor_guest",
    roleKeys: ["doctor_guest"],
    emailVerified: true,
    mfaEnrolled: false,
    idpAccountExpected: true,
    subjectEnvVar: "DS_GOLDEN_SUB_DOCTOR_VERIFIED_W3",
    passwordEnvVar: "DS_GOLDEN_PASSWORD_DOCTOR_VERIFIED",
  }),
  Object.freeze({
    key: "doctorVerifiedW4",
    username: "golden.doctor.verified.w4@example.test",
    role: "doctor_guest",
    roleKeys: ["doctor_guest"],
    emailVerified: true,
    mfaEnrolled: false,
    idpAccountExpected: true,
    subjectEnvVar: "DS_GOLDEN_SUB_DOCTOR_VERIFIED_W4",
    passwordEnvVar: "DS_GOLDEN_PASSWORD_DOCTOR_VERIFIED",
  }),
  Object.freeze({
    key: "doctorVerifiedW5",
    username: "golden.doctor.verified.w5@example.test",
    role: "doctor_guest",
    roleKeys: ["doctor_guest"],
    emailVerified: true,
    mfaEnrolled: false,
    idpAccountExpected: true,
    subjectEnvVar: "DS_GOLDEN_SUB_DOCTOR_VERIFIED_W5",
    passwordEnvVar: "DS_GOLDEN_PASSWORD_DOCTOR_VERIFIED",
  }),
]);

/** Every `DS_GOLDEN_SUB_*` name — the five named accounts and the #2805 worker pool — in catalogue order. */
export const GOLDEN_SUBJECT_ENV_VARS = Object.freeze(
  GOLDEN_IDP_ACCOUNTS.map((account) => account.subjectEnvVar),
);

/**
 * The distinct `DS_GOLDEN_PASSWORD_*` names of the live accounts, in catalogue order.
 * Distinct, because the #2805 worker pool reuses the verified doctor's variable.
 */
export const GOLDEN_PASSWORD_ENV_VARS = Object.freeze([
  ...new Set(
    GOLDEN_IDP_ACCOUNTS.filter((account) => account.idpAccountExpected).map(
      (account) => account.passwordEnvVar,
    ),
  ),
]);

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

/**
 * The pinned URI list as `stage.env` spells it — comma separated, trimmed.
 *
 * The exact split `infra/dev-stand/idp/provision.sh` does (`:281-282`) on the same two
 * keys, so the stage's own hosts survive a slot converge: the write is whole-set, and
 * sending only what the slot registry renders would unregister everything provisioning
 * put there (#2064 addendum 6).
 */
export function parsePinnedUris(text) {
  return String(text ?? "")
    .split(",")
    .map((uri) => uri.trim())
    .filter(Boolean);
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
function oidcConfigBody({ redirectUris, postLogoutRedirectUris, loginVersion }) {
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
    // Login V2 is selected per app (ADR-0015 §4) and this converge OWNS the value as
    // desired state (`sharedAppLoginVersion`), the same one provision.sh step 3 writes:
    // the v1 management update resets an omitted loginVersion to «unspecified»
    // (= Login V1), so every write carries it and a wiped one is restored.
    loginVersion,
  };
}

/**
 * The shared headless app's desired Login V2 version: the IdP's own login UI,
 * `<IdP base URL>/ui/v2/login` — the value provision.sh step 3 derives
 * (`${IDP_LOGIN_BASE_URI:-${BASE_URL}/ui/v2/login}`), honouring the same
 * `IDP_LOGIN_BASE_URI` override. `idpBaseUrl` is the origin the slot tooling already
 * talks to (`resolveIdpBaseUrl` → `createIdpClient().origin`).
 */
export function sharedAppLoginVersion({ idpBaseUrl, loginBaseUri } = {}) {
  const override = String(loginBaseUri ?? "").trim();
  const origin = String(idpBaseUrl ?? "").trim().replace(/\/+$/, "");
  if (!override && !origin) {
    throw new IdpError("the shared app's Login V2 base_uri needs the IdP base URL");
  }
  return { loginV2: { baseUri: assertExactUri(override || `${origin}/ui/v2/login`) } };
}

const loginBaseUriOf = (config) => config?.loginVersion?.loginV2?.baseUri;

/**
 * ensure-present for the WHOLE redirect set AND the app's Login V2 version:
 * `{ action: "skip" }` when the app already carries exactly both, `{ action: "put",
 * body }` otherwise. A matching redirect set whose loginVersion was wiped (a write
 * from tooling that omitted it) or points elsewhere is a PUT, never a skip.
 *
 * The compare is order-insensitive (Zitadel does not promise to echo the order it was
 * given) while the write sends the ordered set, so a converge is stable: a second run
 * over the same registry skips instead of PUTting the same list forever.
 */
export function planRedirectUriConverge({ current, desired }) {
  const redirectUris = [...(desired?.redirectUris ?? [])];
  const postLogoutRedirectUris = [...(desired?.postLogoutUris ?? desired?.postLogoutRedirectUris ?? [])];
  const loginVersion = desired?.loginVersion;
  if (!loginBaseUriOf(desired)) {
    // A write without it would reset the app to Login V1 (see `oidcConfigBody`).
    throw new IdpError("the redirect converge needs the shared app's desired Login V2 version");
  }
  if (
    sameSet(current?.redirectUris, redirectUris) &&
    sameSet(current?.postLogoutRedirectUris, postLogoutRedirectUris) &&
    loginBaseUriOf(current) === loginBaseUriOf(desired)
  ) {
    return { action: "skip" };
  }
  return {
    action: "put",
    body: oidcConfigBody({ redirectUris, postLogoutRedirectUris, loginVersion }),
  };
}

/**
 * The ordered converge steps for the golden fixture, plus the subject map.
 *
 * `existing` maps username → `{ userId, emailVerified, grant }` for the accounts the
 * IdP currently holds (absent ⇒ no entry); `grant` is that user's authorization on
 * the shared project, `{ id, roleKeys }` or `null`. Membership decides the verb:
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
 *
 * The project GRANT is converged the same way, and for the same reason the password
 * is: an account that exists and signs in but carries no `platform_admin` grant is
 * indistinguishable, from the walkthrough's side, from a broken admin. A created
 * account always gets one; a live one gets a step only when its role keys differ
 * from the catalogue's, so a converged box plans nothing here.
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
      if (!sameSet(live.grant?.roleKeys, account.roleKeys)) {
        steps.push({
          op: "ensure-grant",
          username: account.username,
          userId: live.userId,
          key: account.key,
          grantId: live.grant?.id ?? null,
          roleKeys: account.roleKeys,
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
    // Always on the create path: a user Zitadel has just minted carries no
    // authorization at all, so there is nothing to compare against.
    steps.push({
      op: "ensure-grant",
      username: account.username,
      userId: null,
      key: account.key,
      grantId: null,
      roleKeys: account.roleKeys,
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

/** The same file, read back. Unknown names are ignored; every catalogue name is required. */
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
    async request(method, path, body, { allowStatus = [] } = {}) {
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
      // `allowStatus` is only for a caller that proves the outcome by its own re-read.
      if (!res.ok && allowStatus.includes(res.status)) return null;
      if (!res.ok) {
        throw new IdpError(`${method} ${path} answered ${res.status} (IdP at ${origin})`);
      }
      return await res.json();
    },
  };
}

// --- redirect-URI converge ---------------------------------------------------

/**
 * The shared project's id.
 *
 * Its own function because BOTH the redirect converge (which wants the app inside
 * the project) and the grant converge (which wants only the project) need it, and a
 * second copy of this lookup is a second place the «run provision.sh first» refusal
 * could drift.
 */
async function resolveProjectId(client, projectName) {
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
  return projectId;
}

async function resolveSharedApp(client, { projectName, appName }) {
  const projectId = await resolveProjectId(client, projectName);
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
 * What the app's read-back lacks (`missing`) or carries beyond (`extra`) the desired
 * set, per list — a URI held in the wrong list is not converged — plus a Login V2
 * base_uri that differs from the desired one (`loginBaseUri: { want, have }`, else
 * `null`). Every list empty and no Login V2 difference ⇒ converged.
 */
export function diffRedirectSet({ current, desired }) {
  const diff = (have, want) => {
    const h = new Set(have ?? []);
    const w = new Set(want ?? []);
    return {
      missing: [...w].filter((uri) => !h.has(uri)).sort(),
      extra: [...h].filter((uri) => !w.has(uri)).sort(),
    };
  };
  return {
    redirect: diff(current?.redirectUris, desired?.redirectUris),
    postLogout: diff(
      current?.postLogoutRedirectUris,
      desired?.postLogoutUris ?? desired?.postLogoutRedirectUris,
    ),
    loginBaseUri:
      loginBaseUriOf(current) === loginBaseUriOf(desired)
        ? null
        : { want: loginBaseUriOf(desired), have: loginBaseUriOf(current) },
  };
}

const isConverged = ({ redirect, postLogout, loginBaseUri }) =>
  !loginBaseUri &&
  [redirect.missing, redirect.extra, postLogout.missing, postLogout.extra].every(
    (list) => list.length === 0,
  );

/** Converge attempts before a read-back mismatch is a hard failure (#2694). */
export const REDIRECT_CONVERGE_ATTEMPTS = 3;
/** Backoff before attempt N+1 is `N × this`, so 2 s then 4 s. */
export const REDIRECT_CONVERGE_BACKOFF_MS = 2000;

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Converge the WHOLE redirect + post-logout set onto the shared OIDC app.
 *
 * The write is whole-set and parallel sessions converge the same app, so the set is
 * never a start-time snapshot: `readDesired` (an injected effect — the live slot read)
 * yields it immediately before the probe, and again after the write to check the
 * read-back. A read-back that lacks a live slot's callback, or still carries a removed
 * one, re-reads and re-converges, bounded by `attempts` with a growing backoff; still
 * wrong ⇒ `IdpError` naming every missing/extra URI. Never a silent success.
 *
 * The app's Login V2 version is part of the same desired state (`sharedAppLoginVersion`,
 * from the client's IdP origin or `loginBaseUri` = provision.sh's `IDP_LOGIN_BASE_URI`):
 * a parallel write that omitted it (= Login V1, and the api's headless sign-in then 404s
 * on its auth request) is restored by the next converge and checked on the read-back.
 *
 * Probe (`GET .../apps/{id}`) → PUT only on a difference → read-back; any failure of
 * a hop aborts. A slot whose callback is not registered fails login with `invalid
 * redirect_uri`, which is strictly worse than a refused `slot up`.
 */
export async function convergeRedirectUris({
  client,
  desired,
  readDesired = async () => desired,
  projectName = DEFAULT_PROJECT_NAME,
  appName = DEFAULT_APP_NAME,
  log = () => {},
  attempts = REDIRECT_CONVERGE_ATTEMPTS,
  backoffMs = REDIRECT_CONVERGE_BACKOFF_MS,
  sleep = realSleep,
  loginBaseUri,
}) {
  const loginVersion = sharedAppLoginVersion({ idpBaseUrl: client.origin, loginBaseUri });
  const readWant = async () => ({ ...(await readDesired()), loginVersion });
  const { projectId, appId } = await resolveSharedApp(client, { projectName, appName });
  const appPath = `/management/v1/projects/${projectId}/apps/${appId}`;
  let want = await readWant();
  let lastPut;
  let diff;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const current = (await client.request("GET", appPath))?.app?.oidcConfig ?? {};
    const plan = planRedirectUriConverge({ current, desired: want });
    if (plan.action === "put") {
      // A re-converge's probe can see a read-back that lagged the previous PUT, so it
      // PUTs the config the app already holds and Zitadel answers 400 «No changes».
      // That is judged by the read-back below, never surfaced as a bare 400 (the
      // first attempt's probe is fresh, so a 400 there stays a hard failure).
      const answer = await client.request(
        "PUT",
        `${appPath}/oidc_config`,
        plan.body,
        attempt > 1 ? { allowStatus: [400] } : {},
      );
      lastPut = plan.body;
      log(
        answer === null
          ? "  ↳ idp redirect set: PUT answered «no changes» — judging by the read-back"
          : `  ↳ idp redirect set converged: ${plan.body.redirectUris.length} redirect, ` +
              `${plan.body.postLogoutRedirectUris.length} post-logout URI(s)`,
      );
    } else {
      log(`  ↳ idp redirect set already holds ${current.redirectUris?.length ?? 0} URI(s)`);
    }
    const readBack = (await client.request("GET", appPath))?.app?.oidcConfig ?? {};
    // Re-read the live set: a slot that came up (or went down) during this write is
    // judged against the set as it is now, and becomes the next attempt's target.
    want = await readWant();
    diff = diffRedirectSet({ current: readBack, desired: want });
    if (isConverged(diff)) {
      return lastPut
        ? { action: "put", projectId, appId, body: lastPut, attempts: attempt }
        : { action: "skip", projectId, appId, attempts: attempt };
    }
    log(
      `  ↳ idp read-back differs from the live set (attempt ${attempt}/${attempts}): ` +
        describeDiff(diff),
    );
    if (attempt < attempts) await sleep(backoffMs * attempt);
  }
  throw new IdpError(
    `the shared IdP redirect set did not converge after ${attempts} attempt(s) — ` +
      `${describeDiff(diff)}. A parallel slot run may be rewriting it; re-run ` +
      "`stage:slot sync` once it finishes.",
  );
}

// --- storefront OIDC clients per slot (003 EARS-60, ADR-0015 §4) -------------

/** The two storefronts that each get their own confidential OIDC client. */
export const STOREFRONTS = Object.freeze(["academy", "doctor"]);
const STOREFRONT_APP_PREFIX = "ds-storefront-";
const SLOT_STOREFRONT_APP_RE = /^ds-storefront-(academy|doctor)-([a-z0-9][a-z0-9-]*)$/;

/** `ds-storefront-<storefront>-<slot>` — the per-slot client's app name. */
export function storefrontAppName(storefront, slot) {
  return `${STOREFRONT_APP_PREFIX}${storefront}-${slot}`;
}

const assertExactUri = (uri) => {
  // The same refusal provision.sh applies: one exact absolute https URI, never a
  // wildcard / query / glob / list (ADR-0015 §4 req. 1).
  if (!/^https:\/\/[^/\s]+(\/\S*)?$/.test(uri) || /[*?[,]/.test(uri)) {
    throw new IdpError(`refusing to register a non-exact storefront URI: ${JSON.stringify(uri)}`);
  }
  return uri;
};

/**
 * The oidc_config of one slot's storefront client, minus `name` — the stage shape of
 * the payload `provision.sh` step 3.bis builds: exactly one callback and one
 * post-logout URI on the slot's own storefront host, `private_key_jwt`, the slot's
 * sign-in host `login-<slot>` as this app's OWN Login V2 base_uri, and the slot API's
 * back-channel logout endpoint. Every URI is https, so dev mode stays off.
 */
export function storefrontClientConfig({ storefront, slot, baseDomain }) {
  if (!STOREFRONTS.includes(storefront)) {
    throw new IdpError(`unknown storefront ${JSON.stringify(storefront)}`);
  }
  const origin = `https://${storefront}-${slot}.${baseDomain}`;
  return {
    redirectUris: [assertExactUri(`${origin}/auth/callback`)],
    postLogoutRedirectUris: [assertExactUri(`${origin}/`)],
    responseTypes: ["OIDC_RESPONSE_TYPE_CODE"],
    grantTypes: ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE", "OIDC_GRANT_TYPE_REFRESH_TOKEN"],
    appType: "OIDC_APP_TYPE_WEB",
    authMethodType: "OIDC_AUTH_METHOD_TYPE_PRIVATE_KEY_JWT",
    version: "OIDC_VERSION_1_0",
    devMode: false,
    accessTokenType: "OIDC_TOKEN_TYPE_JWT",
    accessTokenRoleAssertion: true,
    idTokenRoleAssertion: true,
    idTokenUserinfoAssertion: true,
    backChannelLogoutUri: assertExactUri(
      `https://api-${slot}.${baseDomain}/v1/auth/back-channel-logout`,
    ),
    loginVersion: { loginV2: { baseUri: assertExactUri(`https://login-${slot}.${baseDomain}`) } },
  };
}

const sameStorefrontConfig = (current, want) =>
  sameSet(current?.redirectUris, want.redirectUris) &&
  (current?.redirectUris ?? []).length === want.redirectUris.length &&
  sameSet(current?.postLogoutRedirectUris, want.postLogoutRedirectUris) &&
  (current?.postLogoutRedirectUris ?? []).length === want.postLogoutRedirectUris.length &&
  current?.authMethodType === want.authMethodType &&
  Boolean(current?.devMode) === want.devMode &&
  current?.backChannelLogoutUri === want.backChannelLogoutUri &&
  current?.loginVersion?.loginV2?.baseUri === want.loginVersion.loginV2.baseUri;

/**
 * What the per-slot storefront clients need: a `create` for each live slot's absent
 * client, an `update` for one whose config drifted, a `remove` for a slot client no
 * live slot owns (a `down`, or a slot that vanished — the whole-registry sweep). Apps
 * outside the `ds-storefront-<storefront>-<slot>` shape — the shared headless app, the
 * dev-default `ds-storefront-<storefront>` clients — are never touched.
 */
export function planStorefrontClients({ slots, baseDomain, existing }) {
  const live = new Set(slots ?? []);
  const byName = new Map();
  const remove = [];
  for (const app of existing ?? []) {
    const match = SLOT_STOREFRONT_APP_RE.exec(app?.name ?? "");
    if (!match) continue;
    if (live.has(match[2])) byName.set(app.name, app);
    else remove.push({ appId: app.id, name: app.name });
  }
  const create = [];
  const update = [];
  let keep = 0;
  for (const slot of [...live].sort()) {
    for (const storefront of STOREFRONTS) {
      const name = storefrontAppName(storefront, slot);
      const body = storefrontClientConfig({ storefront, slot, baseDomain });
      const app = byName.get(name);
      if (!app) create.push({ name, body });
      else if (!sameStorefrontConfig(app.oidcConfig, body)) update.push({ appId: app.id, name, body });
      else keep += 1;
    }
  }
  return { create, update, remove: remove.sort((a, b) => a.name.localeCompare(b.name)), keep };
}

/**
 * Converge the per-slot storefront clients to the live slot set (created on
 * `up`/`sync`, removed on `down` and by the sweep). Read-before-write; any failed hop
 * aborts as an `IdpError`. Only names and app ids are logged — no client key exists
 * here (private_key_jwt keys are minted by the API-side wiring).
 */
export async function convergeStorefrontClients({
  client,
  slots,
  baseDomain,
  projectName = DEFAULT_PROJECT_NAME,
  log = () => {},
}) {
  const projectId = await resolveProjectId(client, projectName);
  const appsPath = `/management/v1/projects/${projectId}/apps`;
  const found = await client.request("POST", `${appsPath}/_search`, {
    queries: [
      { nameQuery: { name: STOREFRONT_APP_PREFIX, method: "TEXT_QUERY_METHOD_STARTS_WITH" } },
    ],
  });
  const plan = planStorefrontClients({ slots, baseDomain, existing: found?.result ?? [] });
  for (const { name, body } of plan.create) {
    const created = await client.request("POST", `${appsPath}/oidc`, { name, ...body });
    log(`  ↳ idp storefront client ${name} created (appId ${created?.appId ?? "?"})`);
  }
  for (const { appId, name, body } of plan.update) {
    await client.request("PUT", `${appsPath}/${appId}/oidc_config`, body);
    log(`  ↳ idp storefront client ${name} converged`);
  }
  for (const { appId, name } of plan.remove) {
    await client.request("DELETE", `${appsPath}/${appId}`);
    log(`  ↳ idp storefront client ${name} removed (no live slot)`);
  }
  if (plan.keep) log(`  ↳ idp storefront clients already converged: ${plan.keep}`);
  return { projectId, ...plan };
}

function describeDiff({ redirect, postLogout, loginBaseUri }) {
  const parts = [];
  if (loginBaseUri) {
    parts.push(
      `login V2 base_uri: want ${loginBaseUri.want}, have ${loginBaseUri.have ?? "none (= Login V1)"}`,
    );
  }
  for (const [name, list] of [
    ["redirect missing", redirect.missing],
    ["redirect extra", redirect.extra],
    ["post-logout missing", postLogout.missing],
    ["post-logout extra", postLogout.extra],
  ]) {
    if (list.length) parts.push(`${name}: ${list.join(", ")}`);
  }
  return parts.join("; ");
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
 * The user's authorization on the shared project, or `null`.
 *
 * The search is by user, not by project — Zitadel's grant search takes one query
 * shape per field and a user has at most a handful of grants — so the project
 * filter happens here. A user granted on some OTHER project must read as «no
 * grant», otherwise the converge would PUT the wrong authorization's roles.
 */
async function findUserGrant(client, { userId, projectId }) {
  const data = await client.request("POST", "/management/v1/users/grants/_search", {
    queries: [{ userIdQuery: { userId } }],
  });
  const hit = (data?.result ?? []).find((item) => item.projectId === projectId);
  if (!hit?.id) return null;
  return { id: hit.id, roleKeys: [...(hit.roleKeys ?? [])] };
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
 * Hard-failure everywhere: every create, password write, verification, grant and delete that
 * actually runs must succeed. The only «nothing to do» outcomes are membership facts
 * (already present / already absent), never a swallowed error.
 *
 * What is deliberately NOT converged: the TOTP enrolment of `doctorMfa` and `admin` —
 * the owner's authenticator holds those factors. `convergeAgentAdmin` below is the one
 * converge that touches a factor, and only that of `STAGE_AGENT_ADMIN` (#2531).
 */
export async function convergeGoldenIdentities({
  client,
  accounts = GOLDEN_IDP_ACCOUNTS,
  passwords = {},
  env = {},
  // The box names its own project (`IDP_PROJECT_NAME` in stage.env — `ds-platform-stage`
  // on stage-1); the dev default is only for a stand that carries no name at all.
  projectName = env.IDP_PROJECT_NAME || DEFAULT_PROJECT_NAME,
  log = () => {},
}) {
  // Fail BEFORE the first write: a converge that creates two accounts and then dies
  // on a missing password leaves a half-built fixture behind.
  const missing = [
    ...new Set(
      accounts
        .filter((account) => account.idpAccountExpected)
        .map((account) => account.passwordEnvVar)
        .filter((name) => !passwords[name]),
    ),
  ];
  if (missing.length) {
    throw new IdpError(
      `missing golden password(s): ${missing.join(", ")} — they are owner-placed in ` +
        "/etc/ds-platform/stage.env (see infra/deploy/stage.env.example)",
    );
  }

  // Resolved on first use only: a box whose every golden account is absent never
  // needs the project until the first grant is written, and a fixture of purely
  // ensure-ABSENT accounts never needs it at all.
  let projectId;
  const projectIdOnce = async () => {
    projectId ??= await resolveProjectId(client, projectName);
    return projectId;
  };

  const existing = {};
  for (const account of accounts) {
    const live = await findUserByUsername(client, account.username);
    if (!live) continue;
    existing[account.username] = account.idpAccountExpected
      ? {
          ...live,
          grant: await findUserGrant(client, {
            userId: live.userId,
            projectId: await projectIdOnce(),
          }),
        }
      : live;
  }

  const { steps, subjects } = planGoldenIdentities({ accounts, existing });
  const byKey = new Map(accounts.map((account) => [account.key, account]));
  const granted = new Set();
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
      // Zitadel's User v2 CreateUser answers `{ id, creationDate, emailCode }` — `id`,
      // NOT the `userId` the older AddHumanUser returned (proven live, #203; the same
      // read is in apps/api/src/auth/idp/zitadel.idp.ts:441-452). `userId` stays as a
      // fallback only so an older Zitadel build cannot silently yield no subject.
      const userId = created?.id ?? created?.userId;
      if (!userId) throw new IdpError(`creating ${step.username} returned no user id`);
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
    } else if (step.op === "ensure-grant") {
      const userId = step.userId ?? existing[step.username]?.userId;
      if (!userId) throw new IdpError(`no user id to grant ${step.username} on`);
      const roles = step.roleKeys.join(", ");
      if (step.grantId) {
        // The authorization exists and carries the wrong roles: REPLACE its role
        // set rather than adding a second grant, which Zitadel would refuse and
        // which would leave the user holding the stale role either way.
        await client.request(
          "PUT",
          `/management/v1/users/${userId}/grants/${step.grantId}`,
          { roleKeys: step.roleKeys },
        );
        log(`  ↳ ${step.username} re-granted ${roles}`);
      } else {
        orgId ??= await resolveOrgId(client, env);
        await client.request("POST", `/management/v1/users/${userId}/grants`, {
          projectId: await projectIdOnce(),
          organizationId: orgId,
          roleKeys: step.roleKeys,
        });
        log(`  ↳ ${step.username} granted ${roles}`);
      }
      granted.add(account.key);
    } else {
      throw new IdpError(`unknown golden identity step: ${step.op}`);
    }
  }

  // Say so out loud when a grant was already right. «Nothing in the log» and «the
  // grant step was silently skipped» read identically on a box the walkthrough
  // then fails on, and this converge is the only place that knows the difference.
  for (const account of accounts) {
    if (!account.idpAccountExpected || granted.has(account.key)) continue;
    log(`  ↳ ${account.username} already holds ${account.roleKeys.join(", ")}`);
  }

  for (const account of accounts) {
    if (subjects[account.subjectEnvVar]) continue;
    const userId = existing[account.username]?.userId;
    if (!userId) throw new IdpError(`no subject resolved for ${account.subjectEnvVar}`);
    subjects[account.subjectEnvVar] = userId;
  }
  return subjects;
}

// --- the agent admin (#2531) -------------------------------------------------

/**
 * The staging-only admin agents sign in as.
 *
 * NOT part of the golden catalogue above, and deliberately so: the golden five mirror
 * `packages/db/src/seed/golden/idp.ts` and are what the seeded dataset references,
 * while this account exists only on the shared stage IdP so that an agent can pass the
 * admin's TOTP challenge without the owner's authenticator. Its mirror row is not
 * seeded: the api heals a missing mirror for an authenticated subject on the first
 * request (`apps/api/src/auth/mirror-self-heal.service.ts`) and marks the staff role
 * from the session's claims in the same pass, which is also what makes the sign-in
 * survive a `sync` that re-seeds the slot database.
 *
 * Same roles as the golden admin; its own username and its own secrets file. The
 * golden `admin` and `doctorMfa` factors belong to the owner's authenticator and are
 * never read, removed or enrolled by this file.
 */
export const STAGE_AGENT_ADMIN = Object.freeze({
  key: "agentAdmin",
  username: "golden.admin.agent@example.test",
  role: "platform_admin",
  roleKeys: Object.freeze(["doctor_guest", "platform_admin"]),
  emailVerified: true,
  mfaEnrolled: true,
  idpAccountExpected: true,
  subjectEnvVar: "DS_STAGE_AGENT_ADMIN_SUB",
  passwordEnvVar: "DS_STAGE_AGENT_ADMIN_PASSWORD",
});

/** The TOTP secret's key in the agent secrets file. */
export const AGENT_ADMIN_TOTP_ENV_VAR = "DS_STAGE_AGENT_ADMIN_TOTP_SECRET";

/**
 * Root-only (0600) and TOOL-owned, unlike the owner-placed golden passwords in
 * `stage.env`: the converge mints the password and the TOTP secret itself, so no
 * owner step stands between an agent and an admin sign-in.
 */
export const AGENT_ADMIN_SECRETS_PATH = "/etc/ds-platform/stage-agent-admin.env";

const AGENT_SECRET_KEYS = Object.freeze([
  STAGE_AGENT_ADMIN.passwordEnvVar,
  AGENT_ADMIN_TOTP_ENV_VAR,
]);

/** The secrets file body. Only the two known keys; an unminted one is omitted. */
export function renderAgentAdminSecrets(secrets) {
  const lines = [
    "# generated by tools/staging/idp.mjs (`ds-slot reset-identities`) — do not edit by hand",
    "# The stage agent admin's password and TOTP secret (#2531). root:root 0600.",
  ];
  for (const key of AGENT_SECRET_KEYS) {
    const value = secrets?.[key];
    if (value) lines.push(`${key}=${value}`);
  }
  lines.push("");
  return lines.join("\n");
}

/** The same file, read back; unknown names are ignored. */
export function parseAgentAdminSecrets(text) {
  const secrets = {};
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && AGENT_SECRET_KEYS.includes(match[1]) && match[2]) secrets[match[1]] = match[2];
  }
  return secrets;
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(text) {
  const clean = String(text ?? "")
    .replace(/\s+/g, "")
    .replace(/=+$/, "")
    .toUpperCase();
  if (!clean || /[^A-Z2-7]/.test(clean)) throw new IdpError("the TOTP secret is not base32");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of clean) {
    value = ((value << 5) | BASE32_ALPHABET.indexOf(char)) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/**
 * RFC 6238 TOTP — SHA-1, 30-second step, six digits: the parameters Zitadel's
 * `POST /v2/users/{id}/totp` registration issues. Pure: the clock arrives as `nowMs`.
 */
export function totpCode(secret, nowMs) {
  const key = base32Decode(secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Number(nowMs) / 1000 / 30)));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, "0");
}

/** The code to type right now, and how many seconds it stays valid. */
export function agentAdminCode(secrets, nowMs) {
  const secret = secrets?.[AGENT_ADMIN_TOTP_ENV_VAR];
  if (!secret) {
    throw new IdpError(
      `${AGENT_ADMIN_SECRETS_PATH} holds no TOTP secret — run \`ds-slot reset-identities <slot>\` first`,
    );
  }
  const secondsLeft = 30 - (Math.floor(Number(nowMs) / 1000) % 30);
  return { code: totpCode(secret, nowMs), secondsLeft };
}

/**
 * What the agent admin's TOTP factor needs.
 *
 * - `absent`, or `not-ready` (a provisional registration nobody verified) → `enrol`:
 *   a repeat `POST /v2/users/{id}/totp` replaces a provisional one.
 * - `ready` with a stored secret → `keep`.
 * - `ready` WITHOUT a stored secret → `replace`: a factor nobody can produce a code
 *   for is a locked door, so it is removed and enrolled again.
 */
export function planAgentAdminTotp({ factor, storedSecret }) {
  if (factor === "absent" || factor === "not-ready") return "enrol";
  if (factor === "ready") return storedSecret ? "keep" : "replace";
  throw new IdpError(`unknown TOTP factor state: ${factor}`);
}

/**
 * The factor, read through the one route family the deployed Zitadel proved it
 * routes (`…/auth_factors/_search`, #1208) — the read `apps/api`'s `hasTotpFactor` does.
 */
async function readTotpFactorState(client, userId) {
  const data = await client.request(
    "POST",
    `/management/v1/users/${encodeURIComponent(userId)}/auth_factors/_search`,
    {},
  );
  const otp = (data?.result ?? []).find((factor) => factor.otp !== undefined);
  if (!otp) return "absent";
  return (otp.otp.state ?? otp.state) === "AUTH_FACTOR_STATE_READY" ? "ready" : "not-ready";
}

/** A password Zitadel's default complexity policy accepts: upper, lower, digit, symbol. */
function defaultRandomPassword() {
  return `Ag7!${randomBytes(18).toString("base64url")}`;
}

/**
 * Converge the agent admin: the account (through `convergeGoldenIdentities`, so it
 * gets the same create / password / verify-email / grant verbs as the golden five),
 * then its TOTP factor — probe → act only when needed → re-read to prove the act.
 *
 * Persistence order keeps a crash recoverable: a minted password is written BEFORE
 * the first IdP write, and a minted TOTP secret BEFORE its verify — so a run that dies
 * halfway leaves either a stored secret for a provisional factor (the next run
 * re-enrols) or no stored secret for a ready one (the next run replaces it).
 *
 * The secrets never reach `log`, an error message, or the return value.
 */
export async function convergeAgentAdmin({
  client,
  readSecrets,
  writeSecrets,
  env = {},
  projectName = env.IDP_PROJECT_NAME || DEFAULT_PROJECT_NAME,
  now = () => Date.now(),
  randomPassword = defaultRandomPassword,
  log = () => {},
  goldenSubjects = {},
}) {
  const account = STAGE_AGENT_ADMIN;
  if (GOLDEN_IDP_ACCOUNTS.some((golden) => golden.username === account.username)) {
    throw new IdpError(`${account.username} is a golden account — refusing to converge its factor`);
  }
  let secrets = { ...((await readSecrets()) ?? {}) };
  if (!secrets[account.passwordEnvVar]) {
    secrets = { ...secrets, [account.passwordEnvVar]: randomPassword() };
    await writeSecrets(secrets);
    log(`  ↳ minted a password for ${account.username} (stored in ${AGENT_ADMIN_SECRETS_PATH})`);
  }

  const subjects = await convergeGoldenIdentities({
    client,
    accounts: [account],
    passwords: { [account.passwordEnvVar]: secrets[account.passwordEnvVar] },
    env,
    projectName,
    log,
  });
  const userId = subjects[account.subjectEnvVar];
  // The fence holds on the id, not only the name: an email search is not unique on
  // Zitadel, so a hit resolving to a golden subject (the owner's factors) stops here.
  const clash = Object.entries(goldenSubjects ?? {}).find(([, id]) => id === userId);
  if (!userId || clash) {
    throw new IdpError(
      `${account.username} resolved to ${clash ? `the golden subject ${clash[0]}` : "no subject"} — refusing to touch a factor`,
    );
  }

  const factor = await readTotpFactorState(client, userId);
  const action = planAgentAdminTotp({
    factor,
    storedSecret: Boolean(secrets[AGENT_ADMIN_TOTP_ENV_VAR]),
  });
  if (action === "keep") {
    log(`  ↳ TOTP already enrolled for ${account.username}`);
    return { subject: userId, totp: "kept" };
  }

  if (action === "replace") {
    // A 404 is ambiguous on this instance (absent factor vs unrouted verb, #1208), so
    // neither it nor a 2xx is the answer — the re-read is.
    await client.request(
      "DELETE",
      `/management/v1/users/${encodeURIComponent(userId)}/auth_factors/otp`,
      undefined,
      { allowStatus: [404] },
    );
    if ((await readTotpFactorState(client, userId)) === "ready") {
      throw new IdpError(
        `${account.username} still holds a TOTP factor after its removal — not enrolling on top`,
      );
    }
    log(`  ↳ removed the TOTP factor of ${account.username} (no stored secret for it)`);
  }

  const registration = await client.request(
    "POST",
    `/v2/users/${encodeURIComponent(userId)}/totp`,
    {},
  );
  if (!registration?.secret) {
    throw new IdpError(`the TOTP registration of ${account.username} returned no secret`);
  }
  secrets = { ...secrets, [AGENT_ADMIN_TOTP_ENV_VAR]: registration.secret };
  await writeSecrets(secrets);
  await client.request("POST", `/v2/users/${encodeURIComponent(userId)}/totp/verify`, {
    code: totpCode(registration.secret, now()),
  });
  if ((await readTotpFactorState(client, userId)) !== "ready") {
    throw new IdpError(`the TOTP factor of ${account.username} is not READY after its verify`);
  }
  log(`  ↳ TOTP enrolled for ${account.username} (secret stored in ${AGENT_ADMIN_SECRETS_PATH})`);
  return { subject: userId, totp: action === "replace" ? "replaced" : "enrolled" };
}
