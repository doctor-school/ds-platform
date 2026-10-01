import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  GOLDEN_IDP_ACCOUNTS,
  GOLDEN_SUBJECT_ENV_VARS,
  IdpError,
  convergeGoldenIdentities,
  convergeRedirectUris,
  createIdpClient,
  goldenDeletedSubject,
  parseGoldenSubjectsEnv,
  planGoldenIdentities,
  planRedirectUriConverge,
  renderGoldenSubjectsEnv,
  parsePinnedUris,
  unionUris,
  AGENT_ADMIN_SECRETS_PATH,
  STAGE_AGENT_ADMIN,
  agentAdminCode,
  convergeAgentAdmin,
  parseAgentAdminSecrets,
  planAgentAdminTotp,
  renderAgentAdminSecrets,
  totpCode,
} from "./idp.mjs";

// CI is Linux and the checkout path differs per runner — never a drive-letter literal.
const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const PASSWORDS = Object.fromEntries(
  GOLDEN_IDP_ACCOUNTS.map((account) => [account.passwordEnvVar, "Secret-123!"]),
);

/** A `fetch` stub: routes are matched by `METHOD /path`, calls are recorded. */
function stubFetch(routes, calls = []) {
  return async (url, init = {}) => {
    const path = new URL(url).pathname;
    const method = init.method ?? "GET";
    const key = `${method} ${path}`;
    calls.push({ key, body: init.body ? JSON.parse(init.body) : undefined, init });
    const answer = routes[key];
    if (!answer) throw new Error(`unrouted request: ${key}`);
    return {
      ok: (answer.status ?? 200) < 400,
      status: answer.status ?? 200,
      async text() {
        return JSON.stringify(answer.body ?? {});
      },
      async json() {
        return answer.body ?? {};
      },
    };
  };
}

const APP_ROUTES = {
  "POST /management/v1/projects/_search": {
    body: { result: [{ id: "p1", name: "ds-platform-dev" }] },
  },
  "POST /management/v1/projects/p1/apps/_search": {
    body: { result: [{ id: "a1", name: "ds-platform-dev" }] },
  },
};

test("the deleted doctor's subject is deterministic, marked and never a Zitadel id", () => {
  const first = goldenDeletedSubject("golden.doctor.deleted@example.test");
  assert.equal(first, goldenDeletedSubject("golden.doctor.deleted@example.test"));
  assert.match(first, /^golden-deleted-[0-9a-f]{32}$/);
  assert.notEqual(first, goldenDeletedSubject("someone.else@example.test"));
});

test("a redirect set that already matches converges to a skip", () => {
  const plan = planRedirectUriConverge({
    // Order differs on purpose: the compare is order-insensitive, the write is ordered.
    current: {
      redirectUris: ["https://b/auth/callback", "https://a/auth/callback"],
      postLogoutRedirectUris: ["https://b", "https://a"],
    },
    desired: {
      redirectUris: ["https://a/auth/callback", "https://b/auth/callback"],
      postLogoutUris: ["https://a", "https://b"],
    },
  });
  assert.equal(plan.action, "skip");
});

test("a differing redirect set converges to a PUT carrying the whole ordered set", () => {
  const plan = planRedirectUriConverge({
    current: { redirectUris: ["https://a/auth/callback"], postLogoutRedirectUris: [] },
    desired: {
      redirectUris: ["https://a/auth/callback", "https://b/auth/callback"],
      postLogoutUris: ["https://a", "https://b"],
    },
  });
  assert.equal(plan.action, "put");
  assert.deepEqual(plan.body.redirectUris, [
    "https://a/auth/callback",
    "https://b/auth/callback",
  ]);
  assert.deepEqual(plan.body.postLogoutRedirectUris, ["https://a", "https://b"]);
  // The PUT is the FULL oidc_config, not a redirect-only patch: the Zitadel update
  // replaces the config wholesale, and `name` is not part of the config resource.
  assert.equal(plan.body.appType, "OIDC_APP_TYPE_WEB");
  assert.equal(plan.body.name, undefined);
});

test("a URI the registry no longer renders is dropped by the converge", () => {
  const plan = planRedirectUriConverge({
    current: {
      redirectUris: ["https://a/auth/callback", "https://gone/auth/callback"],
      postLogoutRedirectUris: ["https://a"],
    },
    desired: { redirectUris: ["https://a/auth/callback"], postLogoutUris: ["https://a"] },
  });
  assert.equal(plan.action, "put");
  assert.deepEqual(plan.body.redirectUris, ["https://a/auth/callback"]);
});

test("pinned URIs from stage.env survive a registry-derived converge", () => {
  assert.deepEqual(unionUris(["https://pinned", "https://a"], ["https://a", "https://b"]), [
    "https://pinned",
    "https://a",
    "https://b",
  ]);
});

test("the pinned URI lists are split exactly the way provision.sh splits them", () => {
  assert.deepEqual(parsePinnedUris("https://a/cb, https://b/cb "), [
    "https://a/cb",
    "https://b/cb",
  ]);
  // An unset or empty pin list is «no pins», never a blank URI in the whole-set write.
  assert.deepEqual(parsePinnedUris(""), []);
  assert.deepEqual(parsePinnedUris(undefined), []);
  assert.deepEqual(parsePinnedUris(",,"), []);
});

test("a failing read of the app config is a hard failure", async () => {
  const client = createIdpClient({
    fetch: stubFetch({
      ...APP_ROUTES,
      "GET /management/v1/projects/p1/apps/a1": { status: 503 },
    }),
    baseUrl: "https://id.stage.example",
    pat: "pat-value",
  });
  await assert.rejects(
    convergeRedirectUris({
      client,
      desired: { redirectUris: ["https://a/auth/callback"], postLogoutUris: [] },
    }),
    IdpError,
  );
});

test("a failing write of the redirect set is a hard failure", async () => {
  const client = createIdpClient({
    fetch: stubFetch({
      ...APP_ROUTES,
      "GET /management/v1/projects/p1/apps/a1": {
        body: { app: { oidcConfig: { redirectUris: [], postLogoutRedirectUris: [] } } },
      },
      "PUT /management/v1/projects/p1/apps/a1/oidc_config": { status: 500 },
    }),
    baseUrl: "https://id.stage.example",
    pat: "pat-value",
  });
  await assert.rejects(
    convergeRedirectUris({
      client,
      desired: { redirectUris: ["https://a/auth/callback"], postLogoutUris: [] },
    }),
    IdpError,
  );
});

test("an already converged app is read and left alone", async () => {
  const calls = [];
  const client = createIdpClient({
    fetch: stubFetch(
      {
        ...APP_ROUTES,
        "GET /management/v1/projects/p1/apps/a1": {
          body: {
            app: {
              oidcConfig: {
                redirectUris: ["https://a/auth/callback"],
                postLogoutRedirectUris: ["https://a"],
              },
            },
          },
        },
      },
      calls,
    ),
    baseUrl: "https://id.stage.example",
    pat: "pat-value",
  });
  const result = await convergeRedirectUris({
    client,
    desired: { redirectUris: ["https://a/auth/callback"], postLogoutUris: ["https://a"] },
  });
  assert.equal(result.action, "skip");
  assert.equal(calls.filter((call) => call.key.startsWith("PUT ")).length, 0);
});

test("an app the shared project does not carry is a hard failure, never a create", async () => {
  const client = createIdpClient({
    fetch: stubFetch({ "POST /management/v1/projects/_search": { body: { result: [] } } }),
    baseUrl: "https://id.stage.example",
    pat: "pat-value",
  });
  await assert.rejects(
    convergeRedirectUris({ client, desired: { redirectUris: [], postLogoutUris: [] } }),
    /provision\.sh/,
  );
});

test("a fresh box plans a create for every expected golden account", () => {
  const { steps, subjects } = planGoldenIdentities({
    accounts: GOLDEN_IDP_ACCOUNTS,
    existing: {},
  });
  assert.equal(steps.filter((step) => step.op === "create").length, 4);
  assert.equal(
    steps.filter((step) => step.op === "delete").length,
    0,
    "nothing exists yet, so nothing may be deleted",
  );
  // The soft-deleted doctor gets its subject without ever touching the IdP.
  assert.match(subjects.DS_GOLDEN_SUB_DOCTOR_DELETED, /^golden-deleted-/);
});

test("a converged box plans no creates and still sets every password", () => {
  const existing = Object.fromEntries(
    GOLDEN_IDP_ACCOUNTS.filter((account) => account.idpAccountExpected).map((account) => [
      account.username,
      { userId: `id-${account.key}`, emailVerified: account.emailVerified },
    ]),
  );
  const { steps, subjects } = planGoldenIdentities({
    accounts: GOLDEN_IDP_ACCOUNTS,
    existing,
  });
  assert.equal(steps.filter((step) => step.op === "create").length, 0);
  assert.equal(steps.filter((step) => step.op === "delete").length, 0);
  assert.equal(steps.filter((step) => step.op === "set-password").length, 4);
  assert.equal(steps.filter((step) => step.op === "verify-email").length, 0);
  assert.equal(subjects.DS_GOLDEN_SUB_ADMIN, "id-admin");
});

test("a golden account is re-verified when the IdP lost the verified flag", () => {
  const { steps } = planGoldenIdentities({
    accounts: GOLDEN_IDP_ACCOUNTS,
    existing: {
      "golden.doctor.verified@example.test": { userId: "id-v", emailVerified: false },
    },
  });
  assert.deepEqual(
    steps.filter((step) => step.op === "verify-email").map((step) => step.userId),
    ["id-v"],
  );
});

test("an account verified when the fixture says it must not be is rebuilt", () => {
  const { steps } = planGoldenIdentities({
    accounts: GOLDEN_IDP_ACCOUNTS,
    existing: {
      "golden.doctor.unverified@example.test": { userId: "id-u", emailVerified: true },
    },
  });
  const ops = steps
    .filter((step) => step.username.includes("unverified"))
    .map((step) => step.op);
  // Zitadel has no un-verify verb, so the only converge back to an UNverified
  // fixture is a rebuild — delete first, then create with the flag off.
  assert.deepEqual(ops, ["delete", "create", "set-password", "ensure-grant"]);
});

test("a created account is always granted its catalogue role", () => {
  const { steps } = planGoldenIdentities({ accounts: GOLDEN_IDP_ACCOUNTS, existing: {} });
  const grants = steps.filter((step) => step.op === "ensure-grant");
  // One per expected account, never for the soft-deleted doctor, and always as an
  // ADD (`grantId: null`) because a freshly minted user holds no authorization.
  assert.equal(grants.length, 4);
  assert.ok(grants.every((step) => step.grantId === null));
  assert.deepEqual(
    grants.find((step) => step.username.includes("admin")).roleKeys,
    ["doctor_guest", "platform_admin"],
  );
});

test("a live account holding the wrong role is re-granted, not re-created", () => {
  const { steps } = planGoldenIdentities({
    accounts: GOLDEN_IDP_ACCOUNTS,
    existing: {
      "golden.admin@example.test": {
        userId: "id-a",
        emailVerified: true,
        grant: { id: "g-1", roleKeys: ["doctor_guest"] },
      },
    },
  });
  const admin = steps.filter((step) => step.username.includes("admin"));
  assert.deepEqual(
    admin.map((step) => step.op),
    ["set-password", "ensure-grant"],
  );
  const grant = admin.find((step) => step.op === "ensure-grant");
  assert.equal(grant.grantId, "g-1");
  assert.equal(grant.userId, "id-a");
  assert.deepEqual(grant.roleKeys, ["doctor_guest", "platform_admin"]);
});

test("a live account already holding its role plans no grant step", () => {
  const existing = Object.fromEntries(
    GOLDEN_IDP_ACCOUNTS.filter((account) => account.idpAccountExpected).map((account) => [
      account.username,
      {
        userId: `id-${account.key}`,
        emailVerified: account.emailVerified,
        grant: { id: `g-${account.key}`, roleKeys: [...account.roleKeys] },
      },
    ]),
  );
  const { steps } = planGoldenIdentities({ accounts: GOLDEN_IDP_ACCOUNTS, existing });
  assert.equal(steps.filter((step) => step.op === "ensure-grant").length, 0);
});

test("the deleted doctor is removed when a live account carries its username", () => {
  const { steps } = planGoldenIdentities({
    accounts: GOLDEN_IDP_ACCOUNTS,
    existing: {
      "golden.doctor.deleted@example.test": { userId: "id-d", emailVerified: true },
    },
  });
  assert.deepEqual(
    steps.filter((step) => step.op === "delete").map((step) => step.userId),
    ["id-d"],
  );
  assert.equal(
    steps.filter((step) => step.username.includes("deleted") && step.op === "create").length,
    0,
    "the soft-deleted doctor must never be re-created",
  );
});

test("the deleted doctor being absent is a no-op", () => {
  const { steps } = planGoldenIdentities({ accounts: GOLDEN_IDP_ACCOUNTS, existing: {} });
  assert.equal(steps.filter((step) => step.username.includes("deleted")).length, 0);
});

test("the golden subjects file round-trips through render and parse", () => {
  const subjects = Object.fromEntries(
    GOLDEN_SUBJECT_ENV_VARS.map((name, index) => [name, `sub-${index}`]),
  );
  assert.deepEqual(parseGoldenSubjectsEnv(renderGoldenSubjectsEnv(subjects)), subjects);
});

test("the golden account catalogue matches the seed contract in packages/db", () => {
  // `tools/staging` runs as plain ESM with zero app deps (no build step), so it
  // cannot import the TypeScript seed contract at runtime. This test reads that file
  // and fails the moment the two drift — the catalogue still has ONE source of truth.
  const source = readFileSync(join(REPO_ROOT, "packages/db/src/seed/golden/idp.ts"), "utf8");
  const field = (block, name) => {
    const match = new RegExp(name + ': ("[^"]+"|true|false)').exec(block);
    return match ? match[1].replaceAll('"', "") : undefined;
  };
  const parsed = source
    .slice(source.indexOf("GOLDEN_IDP_ACCOUNTS"))
    .split("Object.freeze({")
    .slice(1)
    .map((block) => ({
      key: field(block, "key"),
      username: field(block, "username"),
      role: field(block, "role"),
      roleKeys: [...(/roleKeys: \[([^\]]*)\]/.exec(block)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(
        (m) => m[1],
      ),
      emailVerified: field(block, "emailVerified") === "true",
      mfaEnrolled: field(block, "mfaEnrolled") === "true",
      idpAccountExpected: field(block, "idpAccountExpected") === "true",
      subjectEnvVar: field(block, "subjectEnvVar"),
      passwordEnvVar: field(block, "passwordEnvVar"),
    }));
  assert.deepEqual(
    parsed,
    GOLDEN_IDP_ACCOUNTS.map((account) => ({ ...account })),
  );
});

test("a converge creates the absent accounts and collects every subject", async () => {
  const calls = [];
  const client = createIdpClient({
    fetch: stubFetch(
      {
        "POST /v2/users": { body: { result: [] } },
        "GET /auth/v1/users/me": { body: { user: { details: { resourceOwner: "org-1" } } } },
        // The REAL CreateUser response: `{ id, creationDate, emailCode }` (#203).
        "POST /v2/users/new": { body: { id: "new-id", creationDate: "2026-09-11T00:00:00Z" } },
        "POST /v2/users/new-id/password": { body: {} },
        ...APP_ROUTES,
        "POST /management/v1/users/new-id/grants": { body: { userGrantId: "g-new" } },
      },
      calls,
    ),
    baseUrl: "https://id.stage.example",
    pat: "pat-value",
  });
  const lines = [];
  const subjects = await convergeGoldenIdentities({
    client,
    accounts: GOLDEN_IDP_ACCOUNTS,
    passwords: PASSWORDS,
    log: (line) => lines.push(line),
  });
  assert.equal(subjects.DS_GOLDEN_SUB_ADMIN, "new-id");
  assert.match(subjects.DS_GOLDEN_SUB_DOCTOR_DELETED, /^golden-deleted-/);
  assert.equal(calls.filter((call) => call.key === "POST /v2/users/new").length, 4);
  // Every created account is granted, and the admin's grant carries its own role.
  const grants = calls.filter((call) => call.key === "POST /management/v1/users/new-id/grants");
  assert.equal(grants.length, 4);
  assert.ok(grants.some((call) => call.body.roleKeys.includes("platform_admin")));
  assert.ok(grants.every((call) => call.body.projectId === "p1"));
  // Neither the PAT nor any password may reach the log.
  assert.doesNotMatch(lines.join("\n"), /pat-value|Secret-123!/);
});

test("a converge re-grants a live account whose role drifted, and says so", async () => {
  const admin = GOLDEN_IDP_ACCOUNTS.find((account) => account.role === "platform_admin");
  const calls = [];
  const client = createIdpClient({
    fetch: stubFetch(
      {
        "POST /v2/users": {
          body: { result: [{ userId: "id-a", human: { email: { isVerified: true } } }] },
        },
        "POST /management/v1/users/grants/_search": {
          body: { result: [{ id: "g-1", projectId: "p1", roleKeys: ["doctor_guest"] }] },
        },
        "POST /v2/users/id-a/password": { body: {} },
        "PUT /management/v1/users/id-a/grants/g-1": { body: {} },
        ...APP_ROUTES,
      },
      calls,
    ),
    baseUrl: "https://id.stage.example",
    pat: "pat-value",
  });
  const lines = [];
  await convergeGoldenIdentities({
    client,
    accounts: [admin],
    passwords: PASSWORDS,
    log: (line) => lines.push(line),
  });
  const put = calls.find((call) => call.key === "PUT /management/v1/users/id-a/grants/g-1");
  assert.deepEqual(put.body, { roleKeys: ["doctor_guest", "platform_admin"] });
  // An ADD alongside the existing authorization would be a second grant, not a fix.
  assert.equal(
    calls.filter((call) => call.key === "POST /management/v1/users/id-a/grants").length,
    0,
  );
  assert.match(lines.join("\n"), /re-granted doctor_guest, platform_admin/);
});

test("a converge leaves a correct grant alone and logs that it already holds it", async () => {
  const admin = GOLDEN_IDP_ACCOUNTS.find((account) => account.role === "platform_admin");
  const calls = [];
  const client = createIdpClient({
    fetch: stubFetch(
      {
        "POST /v2/users": {
          body: { result: [{ userId: "id-a", human: { email: { isVerified: true } } }] },
        },
        "POST /management/v1/users/grants/_search": {
          body: {
            result: [{ id: "g-1", projectId: "p1", roleKeys: ["platform_admin", "doctor_guest"] }],
          },
        },
        "POST /v2/users/id-a/password": { body: {} },
        ...APP_ROUTES,
      },
      calls,
    ),
    baseUrl: "https://id.stage.example",
    pat: "pat-value",
  });
  const lines = [];
  await convergeGoldenIdentities({
    client,
    accounts: [admin],
    passwords: PASSWORDS,
    log: (line) => lines.push(line),
  });
  assert.equal(
    calls.filter((call) => call.key.includes("/grants/g-1")).length,
    0,
    "an equal role set must not be written back",
  );
  assert.match(
    lines.join("\n"),
    /golden\.admin@example\.test already holds doctor_guest, platform_admin/,
  );
});

test("a grant on some other project does not pass for the shared one", async () => {
  const admin = GOLDEN_IDP_ACCOUNTS.find((account) => account.role === "platform_admin");
  const calls = [];
  const client = createIdpClient({
    fetch: stubFetch(
      {
        "POST /v2/users": {
          body: { result: [{ userId: "id-a", human: { email: { isVerified: true } } }] },
        },
        // Right roles, WRONG project — reading it as a match would leave the shared
        // project ungranted while the converge reported success.
        "POST /management/v1/users/grants/_search": {
          body: { result: [{ id: "g-x", projectId: "other", roleKeys: ["platform_admin"] }] },
        },
        "POST /v2/users/id-a/password": { body: {} },
        "GET /auth/v1/users/me": { body: { user: { details: { resourceOwner: "org-1" } } } },
        "POST /management/v1/users/id-a/grants": { body: { userGrantId: "g-new" } },
        ...APP_ROUTES,
      },
      calls,
    ),
    baseUrl: "https://id.stage.example",
    pat: "pat-value",
  });
  await convergeGoldenIdentities({ client, accounts: [admin], passwords: PASSWORDS });
  const added = calls.find((call) => call.key === "POST /management/v1/users/id-a/grants");
  assert.deepEqual(added.body, {
    projectId: "p1",
    organizationId: "org-1",
    roleKeys: ["doctor_guest", "platform_admin"],
  });
});

test("the subject of a created account comes from the CreateUser `id` field", async () => {
  // Zitadel User v2 answers a create with `{ id, creationDate, emailCode }` and no
  // `userId` at all; reading `userId` yields «returned no user id» on a live converge.
  // This stub carries ONLY `id`, so the old read cannot pass it.
  const calls = [];
  const admin = GOLDEN_IDP_ACCOUNTS.find((account) => account.role === "platform_admin");
  const client = createIdpClient({
    fetch: stubFetch(
      {
        "POST /v2/users": { body: { result: [] } },
        "GET /auth/v1/users/me": { body: { user: { details: { resourceOwner: "org-1" } } } },
        "POST /v2/users/new": { body: { id: "created-id", emailCode: "123456" } },
        "POST /v2/users/created-id/password": { body: {} },
        ...APP_ROUTES,
        "POST /management/v1/users/created-id/grants": { body: { userGrantId: "g-new" } },
      },
      calls,
    ),
    baseUrl: "https://id.stage.example",
    pat: "pat-value",
  });
  const subjects = await convergeGoldenIdentities({
    client,
    accounts: [admin],
    passwords: PASSWORDS,
    log: () => {},
  });
  assert.equal(subjects[admin.subjectEnvVar], "created-id");
  // The password write must address the same id the create returned.
  assert.ok(calls.some((call) => call.key === "POST /v2/users/created-id/password"));
});

test("a missing golden password is refused before anything is written to the IdP", async () => {
  const calls = [];
  const client = createIdpClient({
    fetch: stubFetch({}, calls),
    baseUrl: "https://id.stage.example",
    pat: "pat-value",
  });
  await assert.rejects(
    convergeGoldenIdentities({ client, accounts: GOLDEN_IDP_ACCOUNTS, passwords: {} }),
    /DS_GOLDEN_PASSWORD_ADMIN/,
  );
  assert.deepEqual(calls, []);
});

test("a failing create aborts the converge", async () => {
  const client = createIdpClient({
    fetch: stubFetch({
      "POST /v2/users": { body: { result: [] } },
      "GET /auth/v1/users/me": { body: { user: { details: { resourceOwner: "org-1" } } } },
      "POST /v2/users/new": { status: 500 },
    }),
    baseUrl: "https://id.stage.example",
    pat: "pat-value",
  });
  await assert.rejects(
    convergeGoldenIdentities({
      client,
      accounts: GOLDEN_IDP_ACCOUNTS,
      passwords: PASSWORDS,
    }),
    IdpError,
  );
});

test("a failing password write aborts the converge", async () => {
  const client = createIdpClient({
    fetch: stubFetch({
      "POST /v2/users": {
        body: { result: [{ userId: "id-1", human: { email: { isVerified: false } } }] },
      },
      "POST /v2/users/id-1/password": { status: 500 },
    }),
    baseUrl: "https://id.stage.example",
    pat: "pat-value",
  });
  await assert.rejects(
    convergeGoldenIdentities({
      client,
      accounts: [GOLDEN_IDP_ACCOUNTS[0]],
      passwords: PASSWORDS,
    }),
    IdpError,
  );
});

test("a failing delete of the soft-deleted doctor aborts the converge", async () => {
  const deleted = GOLDEN_IDP_ACCOUNTS.find((account) => !account.idpAccountExpected);
  const client = createIdpClient({
    fetch: stubFetch({
      "POST /v2/users": {
        body: { result: [{ userId: "id-d", human: { email: { isVerified: true } } }] },
      },
      "DELETE /v2/users/id-d": { status: 500 },
    }),
    baseUrl: "https://id.stage.example",
    pat: "pat-value",
  });
  await assert.rejects(
    convergeGoldenIdentities({ client, accounts: [deleted], passwords: PASSWORDS }),
    IdpError,
  );
});

test("the bearer token is sent but never echoed into an error message", async () => {
  const calls = [];
  const client = createIdpClient({
    fetch: stubFetch({ "POST /v2/users": { status: 401, body: { message: "nope" } } }, calls),
    baseUrl: "https://id.stage.example/",
    pat: "pat-value",
  });
  await assert.rejects(
    convergeGoldenIdentities({
      client,
      accounts: [GOLDEN_IDP_ACCOUNTS[0]],
      passwords: PASSWORDS,
    }),
    (err) => {
      assert.ok(err instanceof IdpError);
      assert.doesNotMatch(err.message, /pat-value/);
      return true;
    },
  );
  assert.equal(calls[0].init.headers.Authorization, "Bearer pat-value");
});

test("the grant converge resolves the project the box names in IDP_PROJECT_NAME, not the dev default", async () => {
  const admin = GOLDEN_IDP_ACCOUNTS.find((account) => account.role === "platform_admin");
  const calls = [];
  const client = createIdpClient({
    fetch: stubFetch(
      {
        "POST /v2/users": {
          body: { result: [{ userId: "id-a", human: { email: { isVerified: true } } }] },
        },
        "POST /management/v1/users/grants/_search": { body: { result: [] } },
        "POST /v2/users/id-a/password": { body: {} },
        "POST /management/v1/users/id-a/grants": { body: {} },
        // The stage IdP carries only its own project — the dev name must not be looked up.
        "POST /management/v1/projects/_search": {
          body: { result: [{ id: "p-stage", name: "ds-platform-stage" }] },
        },
      },
      calls,
    ),
    baseUrl: "https://id.stage.example",
    pat: "pat-value",
  });
  await convergeGoldenIdentities({
    client,
    accounts: [admin],
    passwords: PASSWORDS,
    env: { IDP_PROJECT_NAME: "ds-platform-stage", IDP_ORG_ID: "org-1" },
  });
  const search = calls.find((call) => call.key === "POST /management/v1/projects/_search");
  assert.equal(search.body.queries[0].nameQuery.name, "ds-platform-stage");
  const grant = calls.find((call) => call.key === "POST /management/v1/users/id-a/grants");
  assert.equal(grant.body.projectId, "p-stage");
});

// --- #2531: the agent admin and its converged TOTP ---------------------------

// RFC 6238 Appendix B, SHA-1 seed "12345678901234567890" in base32, 6-digit truncation.
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("totpCode reproduces the RFC 6238 SHA-1 vectors", () => {
  assert.equal(totpCode(RFC_SECRET, 59_000), "287082");
  assert.equal(totpCode(RFC_SECRET, 1_111_111_109_000), "081804");
  assert.equal(totpCode(RFC_SECRET, 1_234_567_890_000), "005924");
  assert.equal(totpCode(RFC_SECRET.toLowerCase(), 59_000), "287082");
  assert.throws(() => totpCode("not base32!", 0), IdpError);
});

test("agentAdminCode prints the current code and how long it stays valid", () => {
  const out = agentAdminCode({ DS_STAGE_AGENT_ADMIN_TOTP_SECRET: RFC_SECRET }, 59_000);
  assert.deepEqual(out, { code: "287082", secondsLeft: 1 });
  assert.throws(() => agentAdminCode({}, 0), /reset-identities/);
});

test("the agent admin is its own account, never one of the golden five", () => {
  assert.equal(STAGE_AGENT_ADMIN.username, "golden.admin.agent@example.test");
  assert.deepEqual(STAGE_AGENT_ADMIN.roleKeys, ["doctor_guest", "platform_admin"]);
  assert.ok(!GOLDEN_IDP_ACCOUNTS.some((a) => a.username === STAGE_AGENT_ADMIN.username));
  assert.ok(!GOLDEN_IDP_ACCOUNTS.some((a) => a.key === STAGE_AGENT_ADMIN.key));
  assert.equal(AGENT_ADMIN_SECRETS_PATH, "/etc/ds-platform/stage-agent-admin.env");
});

test("the TOTP plan: absent → enrol, provisional → enrol, ready+secret → keep, ready w/o secret → replace", () => {
  assert.equal(planAgentAdminTotp({ factor: "absent", storedSecret: false }), "enrol");
  assert.equal(planAgentAdminTotp({ factor: "absent", storedSecret: true }), "enrol");
  assert.equal(planAgentAdminTotp({ factor: "not-ready", storedSecret: true }), "enrol");
  assert.equal(planAgentAdminTotp({ factor: "ready", storedSecret: true }), "keep");
  assert.equal(planAgentAdminTotp({ factor: "ready", storedSecret: false }), "replace");
  assert.throws(() => planAgentAdminTotp({ factor: "weird", storedSecret: true }), IdpError);
});

test("the agent secrets file round-trips and never carries anything else", () => {
  const text = renderAgentAdminSecrets({
    DS_STAGE_AGENT_ADMIN_PASSWORD: "Pw-1!x",
    DS_STAGE_AGENT_ADMIN_TOTP_SECRET: RFC_SECRET,
    STRAY: "nope",
  });
  assert.ok(text.endsWith("\n"));
  assert.doesNotMatch(text, /STRAY/);
  assert.deepEqual(parseAgentAdminSecrets(text), {
    DS_STAGE_AGENT_ADMIN_PASSWORD: "Pw-1!x",
    DS_STAGE_AGENT_ADMIN_TOTP_SECRET: RFC_SECRET,
  });
  // A secret not yet minted is omitted, not written blank.
  assert.doesNotMatch(renderAgentAdminSecrets({ DS_STAGE_AGENT_ADMIN_PASSWORD: "p" }), /TOTP_SECRET=/);
});

/** A live agent admin (id-agent) plus a scripted factor-read sequence. */
function agentRoutes({ factorReads, extra = {} }) {
  let read = 0;
  return {
    "POST /v2/users": {
      body: { result: [{ userId: "id-agent", human: { email: { isVerified: true } } }] },
    },
    "POST /management/v1/users/grants/_search": {
      body: {
        result: [{ id: "g-1", projectId: "p1", roleKeys: ["doctor_guest", "platform_admin"] }],
      },
    },
    "POST /v2/users/id-agent/password": { body: {} },
    get "POST /management/v1/users/id-agent/auth_factors/_search"() {
      const state = factorReads[Math.min(read, factorReads.length - 1)];
      read += 1;
      return { body: { result: state ? [{ otp: { state } }] : [] } };
    },
    ...APP_ROUTES,
    ...extra,
  };
}

function agentHarness({ routes, secrets = {} }) {
  const calls = [];
  const writes = [];
  const lines = [];
  const client = createIdpClient({
    fetch: stubFetch(routes, calls),
    baseUrl: "https://id.stage.example",
    pat: "pat-value",
  });
  const run = () =>
    convergeAgentAdmin({
      client,
      readSecrets: async () => ({ ...secrets }),
      writeSecrets: async (next) => {
        writes.push({ ...next, afterCalls: calls.length });
      },
      now: () => 59_000,
      randomPassword: () => "Generated-Pw-1!",
      log: (line) => lines.push(line),
    });
  return { calls, writes, lines, run };
}

test("an absent factor is registered, persisted BEFORE verify, verified with the derived code", async () => {
  const h = agentHarness({
    secrets: { DS_STAGE_AGENT_ADMIN_PASSWORD: "Stored-Pw-1!" },
    routes: agentRoutes({
      factorReads: [null, "AUTH_FACTOR_STATE_READY"],
      extra: {
        "POST /v2/users/id-agent/totp": { body: { uri: "otpauth://totp/x", secret: RFC_SECRET } },
        "POST /v2/users/id-agent/totp/verify": { body: {} },
      },
    }),
  });
  const result = await h.run();
  assert.equal(result.subject, "id-agent");
  assert.equal(result.totp, "enrolled");
  const verifyIndex = h.calls.findIndex((c) => c.key === "POST /v2/users/id-agent/totp/verify");
  assert.deepEqual(h.calls[verifyIndex].body, { code: "287082" });
  // The stored password is reused, never regenerated.
  const pw = h.calls.find((c) => c.key === "POST /v2/users/id-agent/password");
  assert.equal(pw.body.newPassword.password, "Stored-Pw-1!");
  // Exactly one write: the secret lands on the box before the verify call is made.
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].DS_STAGE_AGENT_ADMIN_TOTP_SECRET, RFC_SECRET);
  assert.equal(h.writes[0].DS_STAGE_AGENT_ADMIN_PASSWORD, "Stored-Pw-1!");
  assert.ok(h.writes[0].afterCalls <= verifyIndex);
  assert.ok(!h.calls.some((c) => c.key.startsWith("DELETE")));
  const log = h.lines.join("\n");
  assert.match(log, /TOTP enrolled for golden\.admin\.agent@example\.test/);
  assert.doesNotMatch(log, new RegExp(`${RFC_SECRET}|Stored-Pw-1!|287082|pat-value`));
});

test("a ready factor with a stored secret is kept — no TOTP write, «already enrolled»", async () => {
  const h = agentHarness({
    secrets: {
      DS_STAGE_AGENT_ADMIN_PASSWORD: "Stored-Pw-1!",
      DS_STAGE_AGENT_ADMIN_TOTP_SECRET: RFC_SECRET,
    },
    routes: agentRoutes({ factorReads: ["AUTH_FACTOR_STATE_READY"] }),
  });
  const result = await h.run();
  assert.equal(result.totp, "kept");
  assert.equal(h.writes.length, 0);
  assert.ok(!h.calls.some((c) => /\/totp|DELETE/.test(c.key)));
  assert.match(h.lines.join("\n"), /TOTP already enrolled for golden\.admin\.agent@example\.test/);
});

test("a ready factor WITHOUT a stored secret is removed on the agent account only, then re-enrolled", async () => {
  const h = agentHarness({
    secrets: { DS_STAGE_AGENT_ADMIN_PASSWORD: "Stored-Pw-1!" },
    routes: agentRoutes({
      factorReads: ["AUTH_FACTOR_STATE_READY", null, "AUTH_FACTOR_STATE_READY"],
      extra: {
        "DELETE /management/v1/users/id-agent/auth_factors/otp": { body: {} },
        "POST /v2/users/id-agent/totp": { body: { uri: "otpauth://totp/x", secret: RFC_SECRET } },
        "POST /v2/users/id-agent/totp/verify": { body: {} },
      },
    }),
  });
  const result = await h.run();
  assert.equal(result.totp, "replaced");
  assert.deepEqual(
    h.calls.filter((c) => c.key.startsWith("DELETE")).map((c) => c.key),
    ["DELETE /management/v1/users/id-agent/auth_factors/otp"],
  );
  // Every factor-touching call targets the agent's own id — the hard fence.
  assert.ok(
    h.calls
      .filter((c) => /totp|auth_factors/.test(c.key))
      .every((c) => c.key.includes("/id-agent/")),
  );
});

test("a removal the re-read cannot confirm is a hard failure, never an enrol on top", async () => {
  const h = agentHarness({
    secrets: { DS_STAGE_AGENT_ADMIN_PASSWORD: "Stored-Pw-1!" },
    routes: agentRoutes({
      factorReads: ["AUTH_FACTOR_STATE_READY", "AUTH_FACTOR_STATE_READY"],
      extra: { "DELETE /management/v1/users/id-agent/auth_factors/otp": { status: 404 } },
    }),
  });
  await assert.rejects(h.run(), /still holds a TOTP factor/);
  assert.ok(!h.calls.some((c) => c.key === "POST /v2/users/id-agent/totp"));
});

test("a verify the re-read does not confirm as READY is a hard failure", async () => {
  const h = agentHarness({
    secrets: { DS_STAGE_AGENT_ADMIN_PASSWORD: "Stored-Pw-1!" },
    routes: agentRoutes({
      factorReads: [null, "AUTH_FACTOR_STATE_NOT_READY"],
      extra: {
        "POST /v2/users/id-agent/totp": { body: { uri: "u", secret: RFC_SECRET } },
        "POST /v2/users/id-agent/totp/verify": { body: {} },
      },
    }),
  });
  await assert.rejects(h.run(), /not READY/);
});

test("a missing password is generated and persisted BEFORE the first IdP write", async () => {
  const h = agentHarness({
    secrets: {},
    routes: agentRoutes({
      factorReads: [null, "AUTH_FACTOR_STATE_READY"],
      extra: {
        "POST /v2/users/id-agent/totp": { body: { uri: "u", secret: RFC_SECRET } },
        "POST /v2/users/id-agent/totp/verify": { body: {} },
      },
    }),
  });
  await h.run();
  assert.equal(h.writes[0].DS_STAGE_AGENT_ADMIN_PASSWORD, "Generated-Pw-1!");
  assert.equal(h.writes[0].afterCalls, 0);
  const pw = h.calls.find((c) => c.key === "POST /v2/users/id-agent/password");
  assert.equal(pw.body.newPassword.password, "Generated-Pw-1!");
});
