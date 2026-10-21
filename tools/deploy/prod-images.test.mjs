// tools/deploy/prod-images.test.mjs — Issue #2981: production pulls the recorded
// `main` digests instead of building on api-prod.
//
// Locks the pull contract: a release accepts only a `main` manifest for its own
// SHA, api-prod pulls those digests by reference and builds nothing (no compose
// `build:`, no `docker compose build`, no `run --build`), the pull token is read on
// the box and never rendered, retention covers every pulled repo, and every
// `${VAR:?}` the api-prod compose requires is rendered by the prod paths.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  IMAGE_REGISTRY,
  RECORDED_IMAGE_NAMES,
  REGISTRY_PULL_TOKEN_FILE,
  RegistryError,
  pullTokenProbeScript,
  pullTokenVerdict,
  resolveRecordedImages,
} from "./lib/registry.mjs";
import { shipTreeCommand } from "./lib/remote.mjs";
import {
  API_PROD_ENV_RENDERED_VARS,
  PROD_MANIFEST_POLICY,
  RETAINED_IMAGE_REPOS,
  apiProdPullScript,
  deployShaEnvScript,
  migrateAndUpScript,
  retentionScript,
  validateProdImageManifest,
} from "./prod.mjs";
import { API_PROD_COMPOSE_PATH, deployServiceSet } from "./service-set.mjs";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const PROD_SOURCE = readFileSync(join(REPO_ROOT, "tools", "deploy", "prod.mjs"), "utf8");
const API_PROD_COMPOSE = readFileSync(join(REPO_ROOT, ...API_PROD_COMPOSE_PATH.split("/")), "utf8");

const SHA = "0123456789abcdef0123456789abcdef01234567";
const SHA2 = "89abcdef0123456789abcdef0123456789abcdef";
const digestOf = (hex) => `sha256:${hex.repeat(64)}`;
const recordedImages = (prefix) =>
  Object.freeze(
    Object.fromEntries(
      RECORDED_IMAGE_NAMES.map((name, i) => [name, `${IMAGE_REGISTRY}/${prefix}${name}@${digestOf("abcde"[i])}`]),
    ),
  );
const IMAGES = recordedImages("");
const PR_IMAGES = recordedImages("pr/");
const manifestFor = (overrides = {}) => ({ sha: SHA, ref: "main", images: { ...IMAGES }, ...overrides });

// --- the manifest a release accepts ------------------------------------------

test("2981: a release accepts the `main` manifest recorded for its own SHA", () => {
  assert.deepEqual(validateProdImageManifest(manifestFor(), SHA).images, IMAGES);
});

test("2981: a release refuses a PR manifest, another SHA's manifest, and `pr/` references", () => {
  assert.throws(
    () => validateProdImageManifest(manifestFor({ ref: "pr/7", images: { ...PR_IMAGES } }), SHA),
    (err) => err instanceof RegistryError && /a production release accepts only `main`/.test(err.message),
  );
  assert.throws(() => validateProdImageManifest(manifestFor({ sha: SHA2 }), SHA), /records .* not/);
  assert.throws(() => validateProdImageManifest(manifestFor({ images: { ...PR_IMAGES } }), SHA), RegistryError);
  assert.throws(
    () => validateProdImageManifest(manifestFor({ images: { ...IMAGES, api: `${IMAGE_REGISTRY}/api:${SHA}` } }), SHA),
    RegistryError,
  );
  assert.throws(() => validateProdImageManifest(null, SHA), RegistryError);
});

test("2981: a `--ref` hotfix release accepts the `hotfix/<N>-<slug>` manifest recorded for its SHA", () => {
  const resolved = validateProdImageManifest(manifestFor({ ref: "hotfix/2981-pull-token" }), SHA);
  assert.equal(resolved.ref, "hotfix/2981-pull-token");
  assert.deepEqual(resolved.images, IMAGES);
  // The hotfix manifest proves the images; its references stay in the release
  // namespace — `pr/` references under a hotfix ref are refused.
  assert.throws(
    () => validateProdImageManifest(manifestFor({ ref: "hotfix/2981-pull-token", images: { ...PR_IMAGES } }), SHA),
    RegistryError,
  );
});

test("2981: a release refuses a hotfix ref of the wrong shape", () => {
  for (const ref of [
    "hotfix/pull-token",
    "hotfix/2981",
    "hotfix/2981-Pull_Token",
    "hotfix/2981-x/y",
    "refs/heads/hotfix/2981-x",
    "xhotfix/2981-x",
    "dispatch",
    "pr/2981",
  ]) {
    assert.throws(
      () => validateProdImageManifest(manifestFor({ ref }), SHA),
      (err) => err instanceof RegistryError && /a production release accepts only `main` or /.test(err.message),
      ref,
    );
  }
});

const RUN_URL = "https://github.com/o/r/actions/runs/1";
const run = (overrides = {}) => ({
  databaseId: 1,
  status: "completed",
  conclusion: "success",
  event: "push",
  url: RUN_URL,
  ...overrides,
});
const resolveWith = (runs, manifest = manifestFor()) =>
  resolveRecordedImages({
    ...PROD_MANIFEST_POLICY,
    sha: SHA,
    tmpDir: "/tmp/x",
    gh: async (argv) => (argv[1] === "list" ? JSON.stringify(runs) : ""),
    readText: async () => JSON.stringify(manifest),
  });

test("2981: only a `main` push run is a candidate; a PR run for the same commit names no release", async () => {
  const resolved = await resolveWith([run({ databaseId: 3, event: "pull_request" }), run({ databaseId: 2 })]);
  assert.equal(resolved.run.databaseId, 2);
  await assert.rejects(
    resolveWith([run({ event: "pull_request" })]),
    (err) => err instanceof RegistryError && /no images recorded for .*nothing to release/s.test(err.message),
  );
});

test("2981: a running or failed runtime-images run refuses by run URL — never a build fallback", async () => {
  await assert.rejects(
    resolveWith([run({ status: "in_progress", conclusion: "" })]),
    (err) => err.message.includes(RUN_URL) && /in_progress; retry/.test(err.message),
  );
  await assert.rejects(
    resolveWith([run({ conclusion: "failure" })]),
    (err) => err.message.includes(RUN_URL) && /failure/.test(err.message),
  );
  await assert.rejects(resolveWith([run()], manifestFor({ ref: "pr/7", images: { ...PR_IMAGES } })), /only `main`/);
});

// --- the pull on api-prod -----------------------------------------------------

test("2981: api-prod pulls each recorded digest and tags it ds-<image>:<sha> — nothing is built", () => {
  const script = apiProdPullScript({ sha: SHA, images: IMAGES });
  for (const name of RECORDED_IMAGE_NAMES) {
    assert.ok(script.includes(`docker pull ${IMAGES[name]}`), `pulls ${name} by digest`);
    assert.ok(script.includes(`docker tag ${IMAGES[name]} ds-${name}:${SHA}`), `tags ds-${name}:<sha>`);
    // A tag already carrying the recorded digest is reused, not re-pulled.
    assert.ok(script.includes(`grep -Fxq '${IMAGES[name]}'`));
  }
  assert.ok(script.includes(`ds-api-migrate:${SHA}`), "the migrate image is pulled too");
  assert.doesNotMatch(script, /\bbuild\b|compose/);
  assert.throws(() => apiProdPullScript({ sha: SHA, images: { ...IMAGES, doctor: undefined } }), RegistryError);
  assert.throws(() => apiProdPullScript({ sha: "deadbeef", images: IMAGES }), RegistryError);
});

test("2981: the pull token is read on the box by path; it is never in the rendered script", () => {
  const script = apiProdPullScript({ sha: SHA, images: IMAGES });
  assert.ok(script.includes(`--password-stdin < ${REGISTRY_PULL_TOKEN_FILE}`));
  assert.doesNotMatch(script, /--password[ =]|-p /);
  // Each pull shell logs out on exit, and the script ends logged out.
  assert.ok(script.includes(`trap 'docker logout ${IMAGE_REGISTRY} >/dev/null 2>&1' EXIT;`) ||
    script.includes(`trap '\\''docker logout ${IMAGE_REGISTRY} >/dev/null 2>&1'\\'' EXIT;`));
  assert.equal(script.trim().split("\n").at(-1), `sudo docker logout ${IMAGE_REGISTRY} >/dev/null`);
  // The pre-flight probe answers present/absent only — it never prints the file.
  assert.doesNotMatch(pullTokenProbeScript(), /\bcat\b|<\s*\//);
});

test("2981: a missing or unverifiable pull token refuses with the provisioning instruction", () => {
  assert.equal(pullTokenVerdict("pull-token=present\n", { host: "ds-api-prod" }).ok, true);
  for (const output of ["pull-token=absent\n", "", "garbage"]) {
    const verdict = pullTokenVerdict(output, { host: "ds-api-prod" });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /ds-api-prod/);
    assert.match(verdict.reason, /Container registry/);
  }
});

test("2981: the deploy pulls (never builds), migrates without --build and drops the build-cache step", () => {
  assert.doesNotMatch(PROD_SOURCE, /docker compose build|run --build|serviceBuildScript|buildx prune|BUILDX_NO_DEFAULT_ATTESTATIONS/);
  assert.match(PROD_SOURCE, /pullRecordedImages\(sha, images, \{ label: "api-prod pull", durable: true \}\)/);
  assert.match(PROD_SOURCE, /pullRecordedImages\(sha, images, \{ label: "rollback pull" \}\)/);
  const migrate = migrateAndUpScript();
  assert.match(migrate, /docker compose --profile migrate run --rm migrate <\/dev\/null/);
  assert.doesNotMatch(migrate, /--build/);
});

test("2981: the manifest is resolved in pre-flight, before the ship step touches a box", () => {
  const preflightAt = PROD_SOURCE.indexOf("const images = await resolveProdImages(target);");
  const stageCheckAt = PROD_SOURCE.indexOf("  await assertStageGate(target, Boolean(hotfixRef));");
  assert.ok(preflightAt > 0 && preflightAt < stageCheckAt, "resolved inside pre-flight, before the stage check");
  const deployAt = PROD_SOURCE.indexOf("? await preflight(hotfixRef)");
  const shipAt = PROD_SOURCE.indexOf("await shipTree(sha, API_PROD);");
  assert.ok(deployAt > 0 && deployAt < shipAt);
});

// --- retention ----------------------------------------------------------------

test("2981: retention keeps the last N tags of every pulled repo, ds-api-migrate included", () => {
  assert.deepEqual(RETAINED_IMAGE_REPOS, ["ds-api", "ds-api-migrate", "ds-portal", "ds-admin", "ds-doctor"]);
  const script = retentionScript(3);
  for (const repo of RETAINED_IMAGE_REPOS) assert.match(script, new RegExp(`^prune_repo ${repo} 3$`, "m"));
  // The registry digest records a pull leaves behind are reclaimed with their tags.
  assert.ok(script.includes(`reference=${IMAGE_REGISTRY}/*`));
});

// --- the api-prod compose -----------------------------------------------------

test("2981: the api-prod compose declares no build and tags every ds-* image with the deploy SHA", () => {
  assert.doesNotMatch(API_PROD_COMPOSE, /^\s+build:/m);
  assert.doesNotMatch(API_PROD_COMPOSE, /^ {4}image:.*:local\b/m);
  const dsImages = [...API_PROD_COMPOSE.matchAll(/^ {4}image:\s*(ds-\S+)/gm)].map((m) => m[1]);
  assert.deepEqual(dsImages.sort(), [
    "ds-admin:${DEPLOY_SHA:?}",
    "ds-api-migrate:${DEPLOY_SHA:?}",
    "ds-api:${DEPLOY_SHA:?}",
    "ds-doctor:${DEPLOY_SHA:?}",
    "ds-portal:${DEPLOY_SHA:?}",
  ]);
  // Every pulled image except the one-shot migrate is swapped and verified.
  assert.deepEqual(
    deployServiceSet(API_PROD_COMPOSE).map((s) => s.image),
    ["ds-api", "ds-portal", "ds-admin", "ds-doctor"],
  );
});

test("2981: every `${VAR:?}` the api-prod compose requires is rendered by every prod path", () => {
  const required = [...new Set([...API_PROD_COMPOSE.matchAll(/\$\{([A-Z0-9_]+):\?[^}]*\}/g)].map((m) => m[1]))];
  assert.ok(required.length > 0);
  for (const name of required) {
    assert.ok(API_PROD_ENV_RENDERED_VARS.includes(name), `${name} is rendered into the api-prod .env`);
  }
  // The renderer writes each of them …
  const env = deployShaEnvScript(SHA);
  for (const name of API_PROD_ENV_RENDERED_VARS) assert.ok(env.includes(`${name}=`));
  assert.throws(() => deployShaEnvScript("teardown"));
  // … the shipped tree keeps that file across a ship …
  assert.ok(shipTreeCommand({ liveDir: "~/ds-platform" }).includes("infra/deploy/compose/api-prod/.env"));
  // … and both paths that set the SHA write it BEFORE their first compose call:
  // the deploy before the pull/migrate/up/runtime-config steps, the rollback
  // before its `up -d`. Runtime-config compare/restart only run after a deploy.
  const deployEnvAt = PROD_SOURCE.indexOf("${deployShaEnvScript(sha)}\n`,\n    { label: \"api-prod DEPLOY_SHA\" }");
  const migrateAt = PROD_SOURCE.indexOf('await boxStep(API_PROD, sha, "migrate", migrateAndUpScript()');
  const runtimeAt = PROD_SOURCE.indexOf("await applyRuntimeConfigs();");
  assert.ok(deployEnvAt > 0 && deployEnvAt < migrateAt && migrateAt < runtimeAt);
  const rollbackAt = PROD_SOURCE.indexOf("async function rollback(");
  const rollbackEnvAt = PROD_SOURCE.indexOf("${deployShaEnvScript(sha)}\nsudo docker compose up -d", rollbackAt);
  assert.ok(rollbackEnvAt > rollbackAt);
  // No other api-prod compose invocation exists outside those, the runtime-config
  // helpers and the migrate/up script.
  const composeCalls = PROD_SOURCE.split("\n").filter((line) => /sudo docker compose (?!-f compose\.yml)/.test(line));
  assert.deepEqual(
    composeCalls.map((line) => line.trim()),
    [
      "sudo docker compose --profile migrate run --rm migrate </dev/null",
      "sudo docker compose up -d",
      'container_id=$(sudo docker compose ps -q "$service")',
      "sudo docker compose restart ${services.join(\" \")}",
      "sudo docker compose up -d --no-deps redis",
      "sudo docker compose exec -T pgbackrest /usr/local/bin/backup.sh incr",
      "sudo docker compose exec -T pgbackrest gosu postgres pgbackrest --stanza=ds info | sed -n '1,20p'",
      "sudo docker compose up -d",
    ],
  );
});
