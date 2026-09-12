// tools/staging/slot.test.mjs — Issue #2194 (the slot tool on the production
// deploy shape; staging tech spec §3 «Slots», §5 «Converge», §8 step 4).
//
// The regressions these lock: a slot name never reaches raw SQL, a shell argument
// or a hostname unvalidated; two slots never share a Redis logical database, and
// the allocation does not depend on the order docker happened to list containers
// in; the fourth preview is refused; `main` is never cloned or dropped; the live
// docker state — not a registry file — is the single authority on which slots are
// up; a teardown never removes an image another live slot is still running; and
// every remote command is rendered as TEXT (quoted, heredoc'd) rather than executed
// locally. All offline — every effect is injected.

import assert from "node:assert/strict";
import test from "node:test";

import { GOLDEN_SUBJECTS_PATH, GOLDEN_SUBJECT_ENV_VARS } from "./idp.mjs";
import {
  BUILD_CACHE_RESERVED_SPACE,
  CADDY_CONTAINER,
  GC_FREE_SPACE_FLOOR_BYTES,
  IMAGE_RETENTION,
  PREVIEW_SLOT_CAP,
  REDIS_CONTAINER,
  SLOT_ENV_DIR,
  STAGE_ENV_FILE,
  SLOT_LOG_PATH,
  SlotError,
  allocateRedisDatabase,
  assertImagesBoot,
  assertPreviewCapacity,
  assertRunningVerdict,
  assertSlotName,
  basicAuthHeader,
  buildCommandPlan,
  caddyAttachCommand,
  caddyDetachCommand,
  caddyIsAttached,
  cloneDatabaseStatements,
  composeBase,
  composeProjectName,
  containerAliases,
  databaseAction,
  dropDatabaseStatements,
  healthVerdict,
  migrateCommandPlan,
  parseArgs,
  parseAvailBytes,
  parseEnvFile,
  parseLiveSlots,
  planPruneByFreeSpace,
  planResetIdentities,
  planSlotDown,
  planSlotReset,
  planSlotUp,
  planUnreferencedImageGc,
  pruneScript,
  quoteCommand,
  remoteWriteScript,
  requiredOperatorPassword,
  renderIdpRedirectUris,
  renderSlotDownEnv,
  renderSlotEnv,
  resetIdentitiesLogLine,
  resetLogLine,
  resolveDesiredRedirectSet,
  resolveIdpBaseUrl,
  runSlotCommand,
  runSlotPlan,
  seedCommandPlan,
  shortSha,
  slotComposeFile,
  slotDatabaseName,
  slotEnvPath,
  slotHostnames,
  slotNetworkName,
  slotServiceSet,
  slotTreeDir,
  slotsWithClosedPrs,
  verifyImagesScript,
  verifyRunningScript,
} from "./slot.mjs";

const BASE = "stage.doctor.school";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const SHA2 = "89abcdef0123456789abcdef0123456789abcdef";

/** The five tool-owned subject ids the golden-identity converge returns. */
const SUBJECTS = Object.fromEntries(
  GOLDEN_SUBJECT_ENV_VARS.map((name, index) => [name, `sub-${index + 1}`]),
);

/** What `parseLiveSlots` produces: the live compose projects and their images. */
function live(entries) {
  return Object.fromEntries(
    Object.entries(entries).map(([slot, images]) => [slot, { images }]),
  );
}

const SLOT_IMAGES = (sha) => [
  `ds-api:${sha}`,
  `ds-portal:${sha}`,
  `ds-admin:${sha}`,
  `ds-doctor:${sha}`,
];

function labels(plan) {
  return plan.steps.map((step) => step.label);
}

function stepOf(plan, label) {
  const step = plan.steps.find((entry) => entry.label === label);
  assert.ok(step, `no step labelled "${label}" in ${JSON.stringify(labels(plan))}`);
  return step;
}

// --- names -------------------------------------------------------------------

test("a slot name is `main` or `pr-<N>` and nothing else", () => {
  assert.equal(assertSlotName("main"), "main");
  assert.equal(assertSlotName("pr-2034"), "pr-2034");
  for (const bad of ["", "pr-0", "PR-1", "pr-01", "main; DROP", "../etc", undefined]) {
    assert.throws(() => assertSlotName(bad), SlotError);
  }
});

test("the compose project and network of a slot are derived from its name", () => {
  assert.equal(composeProjectName("pr-7"), "slot-pr-7");
  assert.equal(slotNetworkName("pr-7"), "slot-pr-7");
});

test("the slot database name passes the golden-db identifier guard", () => {
  assert.equal(slotDatabaseName("main"), "ds_main");
  assert.equal(slotDatabaseName("pr-2034"), "ds_pr_2034");
});

test("the four hostnames of a slot follow the wildcard record", () => {
  assert.deepEqual(slotHostnames("pr-7", BASE), {
    academy: `academy-pr-7.${BASE}`,
    doctor: `doctor-pr-7.${BASE}`,
    admin: `admin-pr-7.${BASE}`,
    api: `api-pr-7.${BASE}`,
  });
  assert.throws(() => slotHostnames("pr-7", "not a domain"), SlotError);
});

test("container aliases are exactly what the Caddy (slot) snippet dials", () => {
  assert.deepEqual(containerAliases("pr-7"), {
    api: "pr-7-api",
    portal: "pr-7-portal",
    doctor: "pr-7-doctor",
    admin: "pr-7-admin",
    centrifugo: "pr-7-centrifugo",
  });
});

test("a SHA that is not a full lowercase hex commit id is refused", () => {
  assert.equal(shortSha(SHA), SHA.slice(0, 7));
  for (const bad of ["", "abc", SHA.toUpperCase(), `${SHA}0`]) {
    assert.throws(() => shortSha(bad), SlotError);
  }
});

test("the slot tree and its compose file live under $HOME, one directory per slot", () => {
  assert.equal(slotTreeDir("pr-7"), "$HOME/ds-platform.slots/pr-7");
  assert.equal(
    slotComposeFile("pr-7"),
    "$HOME/ds-platform.slots/pr-7/infra/deploy/compose/slot/compose.yml",
  );
  assert.throws(() => slotTreeDir("../etc"), SlotError);
});

// --- live docker state replaces the registry ---------------------------------

test("live slots are read off the compose project label, never off a registry file", () => {
  const parsed = parseLiveSlots(
    [
      `slot-main\tds-api:${SHA}`,
      `slot-main\tds-portal:${SHA}`,
      `slot-main\tds-api:${SHA}`,
      `slot-pr-7\tds-api:${SHA2}`,
      `stg-infra\tcaddy:2`,
      "\tsome/dangling:latest",
      "",
    ].join("\n"),
  );
  assert.deepEqual(Object.keys(parsed).sort(), ["main", "pr-7"]);
  assert.deepEqual(parsed.main.images, [`ds-api:${SHA}`, `ds-portal:${SHA}`]);
  assert.deepEqual(parsed["pr-7"].images, [`ds-api:${SHA2}`]);
});

test("a compose project that is not a slot is never mistaken for one", () => {
  const parsed = parseLiveSlots(`slot-pr-0\tds-api:${SHA}\nslot-nope\tds-api:${SHA}`);
  assert.deepEqual(parsed, {});
});

test("main owns Redis database 0 and a preview never does", () => {
  assert.equal(allocateRedisDatabase("main", live({})), 0);
  assert.notEqual(allocateRedisDatabase("pr-1", live({})), 0);
});

test("the Redis database of a preview is deterministic", () => {
  assert.equal(allocateRedisDatabase("pr-1", live({})), 1 + (1 % 15));
  assert.equal(allocateRedisDatabase("pr-2034", live({})), 1 + (2034 % 15));
});

test("a taken Redis database is probed past, never shared", () => {
  // `pr-1` and `pr-16` both start at 1 + (N % 15) = 2.
  const slots = live({ "pr-1": [], "pr-16": [] });
  const first = allocateRedisDatabase("pr-1", slots);
  const second = allocateRedisDatabase("pr-16", slots);
  assert.notEqual(first, second);
});

test("Redis allocation does not depend on the order docker listed the slots", () => {
  const a = live({ "pr-1": [], "pr-16": [], "pr-31": [] });
  const b = live({ "pr-31": [], "pr-1": [], "pr-16": [] });
  for (const slot of ["pr-1", "pr-16", "pr-31"]) {
    assert.equal(allocateRedisDatabase(slot, a), allocateRedisDatabase(slot, b));
  }
  // …and the three are still mutually exclusive.
  const assigned = ["pr-1", "pr-16", "pr-31"].map((slot) => allocateRedisDatabase(slot, a));
  assert.equal(new Set(assigned).size, 3);
});

test("`main` never counts against the preview cap, and the fourth preview is refused", () => {
  const full = live({ main: [], "pr-1": [], "pr-2": [], "pr-3": [] });
  assert.equal(assertPreviewCapacity("main", full), "main");
  // An already-live preview converging again is not a fourth one.
  assert.equal(assertPreviewCapacity("pr-2", full), "pr-2");
  assert.throws(() => assertPreviewCapacity("pr-9", full), SlotError);
  assert.equal(PREVIEW_SLOT_CAP, 3);
});

// --- shell rendering ---------------------------------------------------------

test("a command is rendered as quoted TEXT, and `$HOME` is the one expansion kept", () => {
  assert.equal(quoteCommand(["sudo", "docker", "ps", "-a"]), "sudo docker ps -a");
  assert.equal(quoteCommand(["echo", "a b"]), "echo 'a b'");
  assert.equal(quoteCommand(["echo", "it's"]), "echo 'it'\\''s'");
  assert.equal(quoteCommand(["echo", "$USER"]), "echo '$USER'");
  assert.equal(
    quoteCommand(["ls", "$HOME/ds-platform.slots/pr-7"]),
    "ls $HOME/ds-platform.slots/pr-7",
  );
  assert.equal(
    quoteCommand(["sudo", "BUILDX_NO_DEFAULT_ATTESTATIONS=1", "docker", "compose", "build"]),
    "sudo BUILDX_NO_DEFAULT_ATTESTATIONS=1 docker compose build",
  );
});

test("a remote write is a root-owned heredoc, never a redirect the caller owns", () => {
  const script = remoteWriteScript("/etc/ds-platform/slots/main.env", "SLOT=main\n", 0o640);
  assert.match(script, /^sudo mkdir -p \/etc\/ds-platform\/slots$/m);
  assert.match(script, /^sudo tee \/etc\/ds-platform\/slots\/main\.env >\/dev\/null <<'DS_SLOT_EOF'$/m);
  assert.match(script, /^SLOT=main$/m);
  assert.match(script, /^DS_SLOT_EOF$/m);
  assert.match(script, /^sudo chmod 0640 \/etc\/ds-platform\/slots\/main\.env$/m);
  // `sudo cat > path` would redirect as the CALLING user and fail on a root-owned
  // directory — the whole reason this is `tee`.
  assert.ok(!/cat >/.test(script));
});

test("an append never truncates, and the delimiter can never be forged", () => {
  const appended = remoteWriteScript("/var/log/ds-platform/slot.log", "line\n", 0o640, {
    append: true,
  });
  assert.match(appended, /^sudo tee -a \/var\/log\/ds-platform\/slot\.log >\/dev\/null <<'DS_SLOT_EOF'$/m);
  assert.throws(
    () => remoteWriteScript("/tmp/x", "a\nDS_SLOT_EOF\nb\n", 0o640),
    SlotError,
  );
  // A body that does not end in a newline would silently gain one from the heredoc,
  // so the bytes on the box would differ from the bytes that were rendered.
  assert.throws(() => remoteWriteScript("/tmp/x", "no trailing newline", 0o640), SlotError);
});

test("the box env file is parsed, not sourced", () => {
  const env = parseEnvFile(
    [
      "# a comment",
      "",
      "STAGE_BASE_DOMAIN=stage.doctor.school",
      "export IDP_EXTERNAL_SECURE=true",
      'IDP_PROJECT_NAME="DS Platform"',
      "DS_GOLDEN_PASSWORD_DOCTOR='p=a s$s'",
      "MALFORMED",
    ].join("\n"),
  );
  assert.equal(env.STAGE_BASE_DOMAIN, "stage.doctor.school");
  assert.equal(env.IDP_EXTERNAL_SECURE, "true");
  assert.equal(env.IDP_PROJECT_NAME, "DS Platform");
  assert.equal(env.DS_GOLDEN_PASSWORD_DOCTOR, "p=a s$s");
  assert.ok(!("MALFORMED" in env));
});

test("free space on the box is read from `df`, never from the operator's own disk", () => {
  assert.equal(parseAvailBytes("Avail\n123456789\n"), 123456789);
  assert.equal(parseAvailBytes("42"), 42);
  assert.throws(() => parseAvailBytes("not a number"), SlotError);
});

// --- database ----------------------------------------------------------------

test("a preview database is dropped and re-cloned from the golden template", () => {
  const statements = cloneDatabaseStatements("pr-7");
  assert.equal(statements.length, 4);
  assert.match(statements[1], /DROP DATABASE IF EXISTS "ds_pr_7"/);
  assert.match(statements[3], /CREATE DATABASE "ds_pr_7" TEMPLATE "ds_golden"/);
});

test("main is never cloned and never dropped — it is forward-migrated", () => {
  assert.throws(() => cloneDatabaseStatements("main"), SlotError);
  assert.throws(() => dropDatabaseStatements("main"), SlotError);
  const bootstrap = cloneDatabaseStatements("main", { bootstrap: true });
  assert.ok(!bootstrap.some((statement) => /DROP DATABASE/.test(statement)));
  assert.deepEqual(dropDatabaseStatements("main", { allowMain: true }).length, 2);
});

test("what a converge does to the slot database", () => {
  assert.equal(databaseAction({ slot: "pr-7", action: "up", exists: true }), "clone");
  assert.equal(databaseAction({ slot: "main", action: "up", exists: false }), "bootstrap");
  assert.equal(databaseAction({ slot: "main", action: "up", exists: true }), "reuse");
  assert.equal(databaseAction({ slot: "main", action: "sync", exists: false }), "reuse");
});

// --- compose -----------------------------------------------------------------

test("every compose invocation is `sudo`, pinned to the slot's own shipped tree", () => {
  const base = composeBase("pr-7");
  assert.equal(base[0], "sudo");
  assert.deepEqual(base.slice(1, 3), ["docker", "compose"]);
  assert.ok(base.includes("/etc/ds-platform/stage.env"));
  assert.ok(base.includes(slotEnvPath("pr-7")));
  assert.ok(base.includes("slot-pr-7"));
  assert.ok(base.includes(slotComposeFile("pr-7")));
  assert.equal(slotEnvPath("pr-7"), `${SLOT_ENV_DIR}/pr-7.env`);
});

test("images are BUILT on the box from the shipped tree, never pulled from a registry", () => {
  const build = buildCommandPlan("pr-7");
  assert.equal(build.kind, "sh");
  assert.deepEqual(build.command.slice(0, 2), ["sudo", "BUILDX_NO_DEFAULT_ATTESTATIONS=1"]);
  assert.equal(build.command.at(-1), "build");
  assert.equal(build.stallBudget, "build");
  const rendered = quoteCommand(build.command);
  assert.ok(!/ pull/.test(rendered));
  assert.ok(!/ghcr\.io/.test(rendered));
});

test("migrate and the branch golden seed run in the slot's own migrate image", () => {
  for (const plan of [migrateCommandPlan("pr-7"), seedCommandPlan("pr-7")]) {
    assert.equal(plan.kind, "sh");
    assert.ok(plan.command.includes("--profile"));
    assert.ok(plan.command.includes("migrate"));
    assert.ok(plan.command.includes("--rm"));
    assert.equal(plan.command[0], "sudo");
  }
  assert.ok(migrateCommandPlan("pr-7").command.includes("drizzle:migrate:ci"));
  assert.ok(seedCommandPlan("pr-7").command.includes("seed:golden"));
});

test("the boot probe skips the one-shot migrate service instead of demanding a PORT", () => {
  const compose = [
    "services:",
    "  api:",
    "    image: ds-api:${DEPLOY_SHA:-local}",
    "  migrate:",
    "    image: ds-api-migrate:${DEPLOY_SHA:-local}",
    "  portal:",
    "    image: ds-portal:${DEPLOY_SHA:-local}",
    "    environment:",
    '      PORT: "3001"',
    "",
  ].join("\n");
  const set = slotServiceSet(compose);
  assert.deepEqual(
    set.services.map((service) => service.name),
    ["api", "migrate", "portal"],
  );
  assert.deepEqual(
    set.longRunning.map((service) => service.name),
    ["api", "portal"],
  );
  // `api` is excluded from the probe by service-set.mjs itself; `migrate` would
  // otherwise throw for having no pinned PORT.
  assert.deepEqual(
    set.bootProbe.map((service) => service.name),
    ["portal"],
  );
});

// --- caddy -------------------------------------------------------------------

test("Caddy's attachment is planned as verify-then-act in BOTH directions", () => {
  const attach = caddyAttachCommand("pr-7");
  assert.equal(attach.kind, "ensure-present");
  assert.deepEqual(attach.items[0].apply, [
    "sudo",
    "docker",
    "network",
    "connect",
    "slot-pr-7",
    CADDY_CONTAINER,
  ]);
  const detach = caddyDetachCommand("pr-7");
  assert.equal(detach.kind, "ensure-absent");
  assert.deepEqual(detach.items[0].remove, [
    "sudo",
    "docker",
    "network",
    "disconnect",
    "slot-pr-7",
    CADDY_CONTAINER,
  ]);
  assert.equal(attach.items[0].match, detach.items[0].match);
});

test("the attachment probe is read for CONTENT, not for its exit status", () => {
  assert.equal(caddyIsAttached(""), false);
  assert.equal(caddyIsAttached("null"), false);
  assert.equal(caddyIsAttached('{"abc":{"Name":"other"}}'), false);
  assert.equal(caddyIsAttached(`{"abc":{"Name":"${CADDY_CONTAINER}"}}`), true);
  assert.throws(() => caddyIsAttached("not json"), SlotError);
  assert.throws(() => caddyIsAttached("[]"), SlotError);
});

// --- the slot env ------------------------------------------------------------

test("the per-slot env file carries no secret and no short-SHA tag", () => {
  const text = renderSlotEnv({
    slot: "pr-7",
    sha: SHA,
    baseDomain: BASE,
    redisDb: 4,
    goldenSubjects: SUBJECTS,
  });
  assert.match(text, /^SLOT=pr-7$/m);
  assert.match(text, new RegExp(`^DEPLOY_SHA=${SHA}$`, "m"));
  assert.match(text, /^SLOT_DB=ds_pr_7$/m);
  assert.match(text, /^REDIS_URL=redis:\/\/redis:6379\/4$/m);
  assert.match(text, new RegExp(`^IDP_ISSUER=https://id\\.${BASE.replace(/\./g, "\\.")}$`, "m"));
  // The image tag is now the FULL sha, exactly as production tags — there is no
  // `<slot>-<sha7>` tag family left to interpolate.
  assert.ok(!/SLOT_SHA7/.test(text));
  assert.ok(!/PASSWORD/.test(text));
  assert.ok(!/DATABASE_URL/.test(text));
  for (const name of GOLDEN_SUBJECT_ENV_VARS) {
    assert.match(text, new RegExp(`^${name}=${SUBJECTS[name]}$`, "m"));
  }
});

test("a slot env asked for before the golden identities converged refuses and names it", () => {
  assert.throws(
    () =>
      renderSlotEnv({ slot: "pr-7", sha: SHA, baseDomain: BASE, redisDb: 4, goldenSubjects: {} }),
    (err) => err instanceof SlotError && /reset-identities/.test(err.message),
  );
});

test("main's Redis database is 0 in the env file it gets", () => {
  const text = renderSlotEnv({
    slot: "main",
    sha: SHA,
    baseDomain: BASE,
    redisDb: 0,
    goldenSubjects: SUBJECTS,
  });
  assert.match(text, /^REDIS_URL=redis:\/\/redis:6379\/0$/m);
});

test("a teardown renders only what compose needs to ADDRESS the project", () => {
  const text = renderSlotDownEnv({ slot: "pr-7" });
  assert.match(text, /^SLOT=pr-7$/m);
  assert.match(text, /^SLOT_DB=ds_pr_7$/m);
  // No subjects, no SHA: `down` matches containers by project label, and a teardown
  // must stay possible on a box where the golden identities never converged.
  assert.ok(!/DS_GOLDEN_SUB_/.test(text));
  assert.ok(!/DEPLOY_SHA=/.test(text));
});

// --- the shared IdP redirect set ---------------------------------------------

test("the IdP redirect set covers every live slot, ordered and de-duplicated", () => {
  const set = renderIdpRedirectUris(["pr-7", "main", "pr-7"], BASE);
  assert.deepEqual(set.redirectUris, [
    `https://api-main.${BASE}/auth/callback`,
    `https://api-pr-7.${BASE}/auth/callback`,
  ]);
  assert.deepEqual(set.postLogoutUris, [
    `https://academy-main.${BASE}`,
    `https://doctor-main.${BASE}`,
    `https://admin-main.${BASE}`,
    `https://academy-pr-7.${BASE}`,
    `https://doctor-pr-7.${BASE}`,
    `https://admin-pr-7.${BASE}`,
  ]);
});

test("no live slot yields an empty redirect set, never a wildcard", () => {
  assert.deepEqual(renderIdpRedirectUris([], BASE), {
    redirectUris: [],
    postLogoutUris: [],
  });
});

test("the converge writes the env pins unioned with the rendered slot set", () => {
  const step = { desired: renderIdpRedirectUris(["pr-7"], BASE) };
  const resolved = resolveDesiredRedirectSet(step, {
    IDP_REDIRECT_URIS: `https://api.${BASE}/auth/callback`,
    IDP_POST_LOGOUT_URIS: `https://academy.${BASE}`,
  });
  assert.deepEqual(resolved.redirectUris, [
    `https://api.${BASE}/auth/callback`,
    `https://api-pr-7.${BASE}/auth/callback`,
  ]);
  assert.ok(resolved.postLogoutUris.includes(`https://academy.${BASE}`));
  assert.ok(resolved.postLogoutUris.includes(`https://academy-pr-7.${BASE}`));
});

test("no pins in the env leaves the rendered set untouched", () => {
  const step = { desired: renderIdpRedirectUris(["pr-7"], BASE) };
  assert.deepEqual(resolveDesiredRedirectSet(step, {}), step.desired);
});

// --- gc ----------------------------------------------------------------------

test("gc removes only `ds-*:<sha>` images no live slot is running", () => {
  const slots = live({ main: SLOT_IMAGES(SHA) });
  const plan = planUnreferencedImageGc({
    images: [...SLOT_IMAGES(SHA), ...SLOT_IMAGES(SHA2), "caddy:2", "postgres:17"],
    liveSlots: slots,
  });
  assert.deepEqual(plan.remove.sort(), SLOT_IMAGES(SHA2).sort());
  assert.equal(plan.commands[0].kind, "ensure-absent");
  assert.deepEqual(plan.commands[0].items[0].remove.slice(0, 4), [
    "sudo",
    "docker",
    "image",
    "rm",
  ]);
});

test("gc never touches the shared infra images, and plans nothing when there is nothing to do", () => {
  const plan = planUnreferencedImageGc({
    images: ["caddy:2", "postgres:17", "ghcr.io/zitadel/zitadel:v2"],
    liveSlots: live({}),
  });
  assert.deepEqual(plan.remove, []);
  assert.deepEqual(plan.commands, []);
});

test("gc takes down the slots whose PR is no longer open, and never `main`", () => {
  const slots = live({ main: [], "pr-7": [], "pr-8": [] });
  assert.deepEqual(slotsWithClosedPrs(slots, [8]), ["pr-7"]);
  assert.deepEqual(slotsWithClosedPrs(slots, [7, 8]), []);
});

test("the unconditional prune only fires below the free-disk floor", () => {
  assert.deepEqual(planPruneByFreeSpace({ freeBytes: GC_FREE_SPACE_FLOOR_BYTES }).commands, []);
  const low = planPruneByFreeSpace({ freeBytes: GC_FREE_SPACE_FLOOR_BYTES - 1 });
  assert.equal(low.commands.length, 1);
  assert.equal(low.commands[0].command[0], "sudo");
});

// --- the ordered plans -------------------------------------------------------

function upPlan(overrides = {}) {
  return planSlotUp({
    slot: "pr-7",
    sha: SHA,
    liveSlots: live({}),
    baseDomain: BASE,
    action: "up",
    subjects: SUBJECTS,
    actor: "tech-lead",
    ...overrides,
  });
}

test("up: ship → env → build → verify → clone → migrate → seed → up → caddy → idp → verify → health → prune → identities", () => {
  assert.deepEqual(labels(upPlan()), [
    "ship the tree",
    "write slot env",
    "build images",
    "verify images boot",
    "clone database",
    "migrate",
    "seed:golden",
    "up -d",
    "attach caddy",
    "converge the shared IdP redirect set",
    "verify the running images",
    "health",
    "prune images and build cache",
    "write the tool-owned golden subjects",
    "flush the slot's redis logical database",
    "audit the identity reset",
  ]);
});

test("up ships the slot's own tree at the requested SHA, into the slot's own directory", () => {
  const ship = stepOf(upPlan(), "ship the tree");
  assert.equal(ship.kind, "ship");
  assert.equal(ship.sha, SHA);
  assert.equal(ship.liveDir, slotTreeDir("pr-7"));
  assert.equal(ship.tmpPrefix, "ds-slot-pr-7");
  // Nothing of the previous deploy is preserved: the slot tree is disposable.
  assert.deepEqual(ship.preserved, []);
});

test("up verifies the images it built and the containers it started, against the SAME sha", () => {
  const plan = upPlan();
  assert.equal(stepOf(plan, "verify images boot").sha, SHA);
  assert.equal(stepOf(plan, "verify the running images").sha, SHA);
  const health = stepOf(plan, "health");
  assert.equal(health.kind, "health");
  assert.equal(health.url, `https://api-pr-7.${BASE}/v1/health`);
  assert.equal(health.sha, SHA);
});

test("up prunes on production's retention, never on an invented one", () => {
  const prune = stepOf(upPlan(), "prune images and build cache");
  assert.equal(prune.kind, "prune");
  assert.equal(prune.retention, IMAGE_RETENTION);
  assert.equal(prune.reservedSpace, BUILD_CACHE_RESERVED_SPACE);
});

test("up converges the shared IdP set over the live slots PLUS the one coming up", () => {
  const step = stepOf(
    upPlan({ liveSlots: live({ main: [], "pr-7": [] }) }),
    "converge the shared IdP redirect set",
  );
  assert.deepEqual(step.desired, renderIdpRedirectUris(["main", "pr-7"], BASE));
});

test("sync of main forward-migrates and never clones a fresh database", () => {
  const plan = planSlotUp({
    slot: "main",
    sha: SHA,
    liveSlots: live({ main: [] }),
    baseDomain: BASE,
    action: "sync",
    databaseExists: true,
    subjects: SUBJECTS,
    actor: "tech-lead",
  });
  assert.ok(!labels(plan).includes("clone database"));
  assert.ok(labels(plan).includes("migrate"));
});

test("the first `up main` on an empty box bootstraps ds_main from the template", () => {
  const plan = planSlotUp({
    slot: "main",
    sha: SHA,
    liveSlots: live({}),
    baseDomain: BASE,
    action: "up",
    databaseExists: false,
    subjects: SUBJECTS,
    actor: "tech-lead",
  });
  const clone = stepOf(plan, "clone database");
  assert.ok(!clone.statements.some((statement) => /DROP DATABASE/.test(statement)));
});

test("an unknown converge action is refused rather than defaulted to `up`", () => {
  assert.throws(() => upPlan({ action: "maybe" }), SlotError);
});

test("down: env → detach → compose down → network → database → images → tree → env → idp", () => {
  const plan = planSlotDown({
    slot: "pr-7",
    liveSlots: live({ "pr-7": SLOT_IMAGES(SHA) }),
    baseDomain: BASE,
  });
  assert.deepEqual(labels(plan), [
    "ensure slot env",
    "detach caddy",
    "compose down",
    "remove slot network",
    "drop database",
    "remove slot images",
    "remove the slot tree",
    "remove slot env",
    "converge the shared IdP redirect set",
  ]);
  assert.ok(stepOf(plan, "compose down").command.includes("-v"));
});

test("down of main tears the containers down but keeps its persistent database", () => {
  const plan = planSlotDown({ slot: "main", liveSlots: live({ main: [] }), baseDomain: BASE });
  const names = labels(plan);
  assert.ok(!names.includes("drop database"));
  assert.ok(!names.includes("remove slot env"));
  assert.ok(!names.includes("remove the slot tree"));
  assert.ok(!stepOf(plan, "compose down").command.includes("-v"));
});

test("down removes an image no OTHER live slot is running", () => {
  const plan = planSlotDown({
    slot: "pr-7",
    liveSlots: live({ "pr-7": SLOT_IMAGES(SHA), main: SLOT_IMAGES(SHA2) }),
    baseDomain: BASE,
  });
  const step = stepOf(plan, "remove slot images");
  assert.deepEqual(
    step.items.map((item) => item.remove.at(-1)).sort(),
    SLOT_IMAGES(SHA).sort(),
  );
});

test("down NEVER removes an image a second slot at the same SHA is still running", () => {
  // The registry used to hide this: image tags are now global per SHA, so two slots
  // converged on one commit share every tag. Removing them would take the other slot
  // down with an ImageNotFound on its next restart.
  const plan = planSlotDown({
    slot: "pr-7",
    liveSlots: live({ "pr-7": SLOT_IMAGES(SHA), "pr-8": SLOT_IMAGES(SHA) }),
    baseDomain: BASE,
  });
  assert.ok(!labels(plan).includes("remove slot images"));
});

test("down converges the IdP set over the slots that REMAIN", () => {
  const step = stepOf(
    planSlotDown({
      slot: "pr-7",
      liveSlots: live({ main: [], "pr-7": [] }),
      baseDomain: BASE,
    }),
    "converge the shared IdP redirect set",
  );
  assert.deepEqual(step.desired, renderIdpRedirectUris(["main"], BASE));
});

test("the network and image removals are planned as verify-then-remove steps", () => {
  const plan = planSlotDown({
    slot: "pr-7",
    liveSlots: live({ "pr-7": SLOT_IMAGES(SHA) }),
    baseDomain: BASE,
  });
  for (const label of ["remove slot network", "remove slot images"]) {
    assert.equal(stepOf(plan, label).kind, "ensure-absent");
  }
});

// --- reset -------------------------------------------------------------------

test("`reset main` audits, stops the slot, then drops and re-clones `ds_main`", () => {
  const plan = planSlotReset({
    sha: SHA,
    liveSlots: live({ main: [] }),
    baseDomain: BASE,
    actor: "tech-lead",
    subjects: SUBJECTS,
  });
  const names = labels(plan);
  assert.deepEqual(names.slice(0, 3), [
    "audit the reset",
    "compose down",
    "re-clone the main database from the template",
  ]);
  const sql = stepOf(plan, "re-clone the main database from the template");
  assert.ok(sql.statements.some((statement) => /DROP DATABASE IF EXISTS "ds_main"/.test(statement)));
  assert.ok(!sql.statements.some((statement) => /DROP DATABASE IF EXISTS "ds_golden"/.test(statement)));
  // The converge that follows must NOT emit a second clone.
  assert.equal(names.filter((name) => name === "clone database").length, 0);
});

test("`reset main` refuses without a SHA to re-converge on", () => {
  assert.throws(
    () =>
      planSlotReset({
        sha: undefined,
        liveSlots: live({ main: [] }),
        baseDomain: BASE,
        actor: "tech-lead",
        subjects: SUBJECTS,
      }),
    SlotError,
  );
});

test("the audit lines name the human, the moment and the SHA", () => {
  const now = new Date("2026-09-11T10:00:00.000Z");
  assert.equal(
    resetLogLine({ actor: "tech-lead", sha: SHA, now }),
    `2026-09-11T10:00:00.000Z reset main by tech-lead sha=${SHA}\n`,
  );
  assert.equal(
    resetIdentitiesLogLine({ slot: "pr-7", actor: "tech-lead", now }),
    "2026-09-11T10:00:00.000Z reset-identities pr-7 by tech-lead\n",
  );
});

// --- reset-identities --------------------------------------------------------

test("`reset-identities` writes the subjects, flushes the slot's database and audits", () => {
  const plan = planResetIdentities({
    slot: "pr-7",
    liveSlots: live({ "pr-7": [] }),
    subjects: SUBJECTS,
    actor: "tech-lead",
  });
  assert.deepEqual(labels(plan), [
    "write the tool-owned golden subjects",
    "flush the slot's redis logical database",
    "audit the identity reset",
  ]);
  assert.equal(stepOf(plan, "write the tool-owned golden subjects").path, GOLDEN_SUBJECTS_PATH);
  const flush = stepOf(plan, "flush the slot's redis logical database");
  assert.deepEqual(flush.command, [
    "sudo",
    "docker",
    "exec",
    REDIS_CONTAINER,
    "redis-cli",
    "-n",
    String(plan.redisDb),
    "FLUSHDB",
  ]);
  assert.equal(stepOf(plan, "audit the identity reset").path, SLOT_LOG_PATH);
});

test("`reset-identities` flushes `main`'s database 0, never a preview's", () => {
  const plan = planResetIdentities({
    slot: "main",
    liveSlots: live({ main: [] }),
    subjects: SUBJECTS,
    actor: "tech-lead",
  });
  assert.equal(plan.redisDb, 0);
});

test("`reset-identities` refuses a preview that is not up and so owns no database", () => {
  assert.throws(
    () =>
      planResetIdentities({
        slot: "pr-7",
        liveSlots: live({ main: [] }),
        subjects: SUBJECTS,
        actor: "tech-lead",
      }),
    SlotError,
  );
});

// --- the executor ------------------------------------------------------------

function recordingEffects(extra = {}) {
  const calls = [];
  return {
    calls,
    effects: {
      sql: async (statement) => calls.push(["sql", statement]),
      sh: async (command) => calls.push(["sh", command.join(" ")]),
      write: async (path) => calls.push(["write", path]),
      append: async (path) => calls.push(["append", path]),
      probe: async () => ({ ok: false, stdout: "", stderr: "" }),
      idp: async (step) => {
        calls.push(["idp", step.op]);
        return undefined;
      },
      ...extra,
    },
  };
}

test("the executor runs every step in order through injected effects", async () => {
  const { calls, effects } = recordingEffects();
  await runSlotPlan(
    {
      steps: [
        { kind: "sql", label: "sql", statements: ["SELECT 1", "SELECT 2"] },
        { kind: "sh", label: "sh", command: ["true"] },
        { kind: "write", label: "write", path: "/tmp/a", contents: "x\n", mode: 0o640 },
        { kind: "append", label: "append", path: "/tmp/b", contents: "x\n", mode: 0o640 },
        { kind: "idp", label: "idp", op: "redirect-uris", desired: {} },
      ],
    },
    effects,
  );
  assert.deepEqual(calls, [
    ["sql", "SELECT 1"],
    ["sql", "SELECT 2"],
    ["sh", "true"],
    ["write", "/tmp/a"],
    ["append", "/tmp/b"],
    ["idp", "redirect-uris"],
  ]);
});

test("a failing step aborts the run", async () => {
  const { calls, effects } = recordingEffects({
    sh: async () => {
      throw new Error("boom");
    },
  });
  await assert.rejects(
    runSlotPlan(
      {
        steps: [
          { kind: "sh", label: "sh", command: ["false"] },
          { kind: "sql", label: "sql", statements: ["SELECT 1"] },
        ],
      },
      effects,
    ),
    /boom/,
  );
  assert.deepEqual(calls, []);
});

test("an `ensure-absent` item a probe finds absent is a success with nothing to do", async () => {
  const { calls, effects } = recordingEffects();
  await runSlotPlan(
    {
      steps: [
        {
          kind: "ensure-absent",
          label: "remove",
          items: [{ probe: ["inspect"], remove: ["rm"] }],
        },
      ],
    },
    effects,
  );
  assert.deepEqual(calls, []);
});

test("an `ensure-present` item a probe finds absent IS applied, and a failure aborts", async () => {
  const { calls, effects } = recordingEffects();
  await runSlotPlan(
    {
      steps: [
        {
          kind: "ensure-present",
          label: "attach",
          items: [{ probe: ["inspect"], apply: ["connect"] }],
        },
      ],
    },
    effects,
  );
  assert.deepEqual(calls, [["sh", "connect"]]);
});

test("an item that reads its probe's OUTPUT refuses an effect set with no `probe`", async () => {
  const { effects } = recordingEffects({ probe: undefined });
  await assert.rejects(
    runSlotPlan({ steps: [caddyAttachCommand("pr-7")] }, effects),
    /needs a `probe` effect/,
  );
});

test("an `append` step refuses a `write`-only effect set rather than truncating the trail", async () => {
  const { effects } = recordingEffects({ append: undefined });
  await assert.rejects(
    runSlotPlan(
      { steps: [{ kind: "append", label: "audit", path: "/tmp/x", contents: "x\n", mode: 0o640 }] },
      effects,
    ),
    /needs an `append`/,
  );
});

test("an `idp` step refuses an effect set without one rather than skipping the converge", async () => {
  const { effects } = recordingEffects({ idp: undefined });
  await assert.rejects(
    runSlotPlan(
      { steps: [{ kind: "idp", label: "converge", op: "redirect-uris", desired: {} }] },
      effects,
    ),
    /needs an `idp`/,
  );
});

test("every remote-only step kind refuses by NAME rather than being silently skipped", async () => {
  const { effects } = recordingEffects();
  for (const [kind, effect] of [
    ["ship", "ship"],
    ["verify-images", "verifyImages"],
    ["verify-running", "verifyRunning"],
    ["health", "health"],
    ["prune", "prune"],
  ]) {
    await assert.rejects(
      runSlotPlan({ steps: [{ kind, label: kind }] }, effects),
      new RegExp(`needs (a|an) \`${effect}\` effect`),
    );
  }
});

test("an unknown step kind is a hard failure, never a no-op", async () => {
  const { effects } = recordingEffects();
  await assert.rejects(
    runSlotPlan({ steps: [{ kind: "teleport", label: "t" }] }, effects),
    /unknown step kind/,
  );
});

// --- the CLI -----------------------------------------------------------------

test("the CLI takes the ref as `--ref <sha>`, the spelling the spec uses", () => {
  assert.deepEqual(parseArgs(["up", "pr-7", "--ref", SHA]), {
    command: "up",
    slot: "pr-7",
    sha: SHA,
  });
  assert.deepEqual(parseArgs(["sync", "main", "--ref", SHA]), {
    command: "sync",
    slot: "main",
    sha: SHA,
  });
  assert.throws(() => parseArgs(["up", "pr-7", SHA]), SlotError);
  assert.throws(() => parseArgs(["up", "pr-7"]), SlotError);
  assert.throws(() => parseArgs(["up", "pr-7", "--ref", "nope"]), SlotError);
});

test("the CLI parses the slot-only and argument-less commands", () => {
  assert.deepEqual(parseArgs(["down", "pr-7"]), {
    command: "down",
    slot: "pr-7",
    sha: undefined,
  });
  assert.deepEqual(parseArgs(["reset-identities", "pr-7"]).command, "reset-identities");
  assert.equal(parseArgs(["status"]).command, "status");
  assert.equal(parseArgs(["gc"]).command, "gc");
  assert.throws(() => parseArgs(["status", "extra"]), SlotError);
  assert.throws(() => parseArgs([]), SlotError);
  assert.throws(() => parseArgs(["teleport"]), SlotError);
});

test("`render` is gone — the edge is a static regexp vhost, not a generated include", () => {
  assert.throws(() => parseArgs(["render"]), SlotError);
});

test("`reset` refuses without `--yes`, and only `main` is resettable", () => {
  assert.deepEqual(parseArgs(["reset", "main", "--yes"]), {
    command: "reset",
    slot: "main",
    sha: undefined,
    yes: true,
  });
  assert.throws(() => parseArgs(["reset", "main"]), SlotError);
  assert.throws(() => parseArgs(["reset", "pr-7", "--yes"]), SlotError);
  assert.throws(() => parseArgs(["reset", "main", "--force"]), SlotError);
});

// --- the command layer -------------------------------------------------------

test("`up` converges the golden identities FIRST — its subjects are the plan's input", async () => {
  const seen = [];
  const effects = {
    sql: async () => {},
    sh: async () => {},
    write: async (path, contents) => seen.push([path, contents]),
    append: async () => {},
    probe: async () => ({ ok: true, stdout: `{"a":{"Name":"${CADDY_CONTAINER}"}}` }),
    idp: async (step) => {
      seen.push(["idp", step.op]);
      return step.op === "golden-identities" ? SUBJECTS : undefined;
    },
    ship: async () => {},
    verifyImages: async () => {},
    verifyRunning: async () => {},
    health: async () => {},
    prune: async () => {},
  };
  const line = await runSlotCommand({
    options: { command: "up", slot: "pr-7", sha: SHA, actor: "tech-lead" },
    liveSlots: live({}),
    baseDomain: BASE,
    effects,
  });
  assert.equal(seen[0][1], "golden-identities");
  const env = seen.find(([path]) => path === slotEnvPath("pr-7"));
  assert.ok(env, "the slot env was written");
  assert.match(env[1], new RegExp(`${GOLDEN_SUBJECT_ENV_VARS[0]}=${SUBJECTS[GOLDEN_SUBJECT_ENV_VARS[0]]}`));
  assert.match(line, /slot pr-7 converged/);
});

test("`down` needs no golden identities — a teardown must never be blocked by them", async () => {
  const calls = [];
  const effects = {
    sql: async () => {},
    sh: async (command) => calls.push(command.join(" ")),
    write: async () => {},
    append: async () => {},
    probe: async () => ({ ok: false, stdout: "" }),
    idp: async () => undefined,
  };
  const line = await runSlotCommand({
    options: { command: "down", slot: "pr-7", actor: "tech-lead" },
    liveSlots: live({ "pr-7": [] }),
    baseDomain: BASE,
    effects,
  });
  assert.match(line, /slot pr-7 is down/);
  assert.ok(calls.some((command) => /compose .*down/.test(command)));
});

test("`reset-identities` refuses an effect set with no `idp` effect", async () => {
  await assert.rejects(
    runSlotCommand({
      options: { command: "reset-identities", slot: "main", actor: "tech-lead" },
      liveSlots: live({ main: [] }),
      baseDomain: BASE,
      effects: { sql: async () => {}, sh: async () => {}, write: async () => {} },
    }),
    /needs an `idp` effect/,
  );
});

// --- the shared IdP origin ---------------------------------------------------

test("an explicit `IDP_BASE_URL` wins over the `IDP_EXTERNAL_*` trio", () => {
  assert.equal(
    resolveIdpBaseUrl({ IDP_BASE_URL: "https://id.example.org/", IDP_EXTERNAL_DOMAIN: "other" }),
    "https://id.example.org",
  );
});

test("the shared IdP origin comes from the trio, with the default port left implicit", () => {
  assert.equal(
    resolveIdpBaseUrl({
      IDP_EXTERNAL_DOMAIN: `id.${BASE}`,
      IDP_EXTERNAL_PORT: "443",
      IDP_EXTERNAL_SECURE: "true",
    }),
    `https://id.${BASE}`,
  );
  assert.equal(
    resolveIdpBaseUrl({
      IDP_EXTERNAL_DOMAIN: "localhost",
      IDP_EXTERNAL_PORT: "8080",
      IDP_EXTERNAL_SECURE: "false",
    }),
    "http://localhost:8080",
  );
});

test("an env carrying neither route is refused naming BOTH", () => {
  assert.throws(
    () => resolveIdpBaseUrl({}),
    (err) =>
      err instanceof SlotError &&
      /IDP_BASE_URL/.test(err.message) &&
      /IDP_EXTERNAL_DOMAIN/.test(err.message),
  );
});

// --- the five remote-only routines -------------------------------------------
//
// `ship` / `verify-images` / `verify-running` / `health` / `prune` are the steps with
// no offline fallback, so what is locked here is the TEXT each one sends to the box
// and the verdict each one reads back — never a live ssh. The shapes are production's
// (`tools/deploy/prod.mjs` `verifyImagesBoot` / `verifyRunningSha` / retention), and
// these tests are what keeps the pair from drifting into two different verifications.

/** The slot compose's SHA-tagged set, as `slotServiceSet` derives it. */
const BOOT_SERVICES = [
  { name: "api", image: "ds-api", port: 3000 },
  { name: "portal", image: "ds-portal", port: 3001 },
];
const RUNNING_SERVICES = [
  ...BOOT_SERVICES,
  { name: "doctor", image: "ds-doctor", port: 3004 },
];

test("the boot probe runs each image with BOTH compose env files and no published port", () => {
  const script = verifyImagesScript({ slot: "pr-7", sha: SHA, services: BOOT_SERVICES });
  assert.ok(script.includes(`--env-file ${STAGE_ENV_FILE}`));
  assert.ok(script.includes(`--env-file ${slotEnvPath("pr-7")}`));
  // Slot-scoped throwaway name: two slots boot-probing the same commit at once must
  // not collide on one container name.
  assert.match(script, /name="ds-slotcheck-pr-7-\$svc"/);
  assert.ok(script.includes(`"$repo:${SHA}"`));
  assert.ok(!/-p \d|--publish/.test(script), "the probe publishes no port");
  assert.match(script, /^probe api ds-api 3000$/m);
  assert.match(script, /^probe portal ds-portal 3001$/m);
});

test("the boot probe refuses a slot name and a SHA that are not derivable", () => {
  assert.throws(() => verifyImagesScript({ slot: "prod", sha: SHA, services: BOOT_SERVICES }), SlotError);
  assert.throws(() => verifyImagesScript({ slot: "pr-7", sha: "deadbeef", services: BOOT_SERVICES }), SlotError);
});

test("a non-booting image fails the converge by name; all-OK passes", () => {
  assert.throws(
    () => assertImagesBoot("api=OK\nportal=EXITED\n---- portal boot log ----", BOOT_SERVICES),
    (err) => err instanceof SlotError && /portal=EXITED/.test(err.message),
  );
  // A service the box printed no verdict for is a FAILURE, never a pass: a probe
  // whose output was truncated must not read as "everything booted".
  assert.throws(() => assertImagesBoot("api=OK", BOOT_SERVICES), /portal=NO-VERDICT/);
  assert.doesNotThrow(() => assertImagesBoot("api=OK\nportal=OK", BOOT_SERVICES));
});

test("the running verify asserts the SHA-tagged image AND health, per the container-name contract", () => {
  const script = verifyRunningScript({ slot: "pr-7", sha: SHA, services: RUNNING_SERVICES });
  for (const service of RUNNING_SERVICES) {
    // `container_name: ${SLOT}-<service>` — the Caddyfile dials these names too.
    assert.match(script, new RegExp(`docker inspect ${containerAliases("pr-7")[service.name]} `));
    assert.match(script, new RegExp(`= "${service.image}:${SHA}"`));
  }
  assert.match(script, /_h" = healthy/);
});

test("a running verify that did not converge fails the run rather than reporting success", () => {
  assert.throws(
    () => assertRunningVerdict("TIMEOUT api=ds-api:old(healthy)", { slot: "pr-7", sha: SHA }),
    (err) => err instanceof SlotError && /do NOT carry/.test(err.message) && /TIMEOUT/.test(err.message),
  );
  assert.doesNotThrow(() => assertRunningVerdict(`OK api=ds-api:${SHA}(healthy)`, { slot: "pr-7", sha: SHA }));
});

test("the prune derives the `ds-*` repos from the box and caps the BuildKit cache", () => {
  const script = pruneScript({ retention: IMAGE_RETENTION, reservedSpace: BUILD_CACHE_RESERVED_SPACE });
  assert.match(script, /docker images --format '\{\{\.Repository\}\}'/);
  assert.match(script, /\^ds-/);
  assert.ok(script.includes(`prune_repo "$repo" ${IMAGE_RETENTION}`));
  assert.match(script, new RegExp(`buildx prune -f --reserved-space ${BUILD_CACHE_RESERVED_SPACE}`));
});

test("the health verdict reads the version the slot's api actually serves", () => {
  assert.deepEqual(healthVerdict({ status: 200, body: `{"version":"${SHA}"}`, sha: SHA }).ok, true);
  // Caddy's stand-wide basic auth answers 401 when the operator password is wrong.
  assert.match(healthVerdict({ status: 401, body: "", sha: SHA }).reason, /401/);
  assert.match(
    healthVerdict({ status: 200, body: `{"version":"${SHA2}"}`, sha: SHA }).reason,
    new RegExp(SHA2.slice(0, 12)),
  );
  assert.match(healthVerdict({ status: 200, body: "not json", sha: SHA }).reason, /JSON/);
  assert.match(healthVerdict({ status: 200, body: "{}", sha: SHA }).reason, /version/);
});

test("the health step fails closed without the operator-machine basic-auth password", () => {
  assert.throws(
    () => requiredOperatorPassword({}),
    (err) => err instanceof SlotError && /STAGE_BASIC_AUTH_PASS/.test(err.message),
  );
  assert.equal(requiredOperatorPassword({ STAGE_BASIC_AUTH_PASS: "s3cret" }), "s3cret");
  assert.equal(basicAuthHeader("stage", "s3cret"), `Basic ${Buffer.from("stage:s3cret").toString("base64")}`);
});
