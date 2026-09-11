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
  assert.deepEqual(ops, ["delete", "create", "set-password"]);
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
  // `tools/staging` ships to /opt/ds-platform as plain ESM with zero app deps, so it
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
        "POST /v2/users/new": { body: { userId: "new-id" } },
        "POST /v2/users/new-id/password": { body: {} },
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
  // Neither the PAT nor any password may reach the log.
  assert.doesNotMatch(lines.join("\n"), /pat-value|Secret-123!/);
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
