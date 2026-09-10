// tools/staging/slot.test.mjs — Issue #2064 part 1 (staging tech spec §3 «Slots»,
// §5 «Converge», §8 step 4).
//
// The regressions these lock: a slot name never reaches raw SQL, a shell argument
// or a hostname unvalidated; two slots never share a Redis logical database; the
// fourth preview is refused; `main` is never cloned or dropped; the `ask` registry
// and the `import slot` lines are rendered from ONE registry, so a host can never
// get a certificate for a slot that is not up; and the box never builds anything.
// All offline — every effect is injected.

import assert from "node:assert/strict";
import test from "node:test";

import {
  CADDY_CONTAINER,
  CADDY_INCLUDE_DIR,
  GC_FREE_SPACE_FLOOR_BYTES,
  GHCR_REPO,
  PREVIEW_SLOT_CAP,
  REGISTRY_PATH,
  SLOT_ENV_DIR,
  SLOT_IMAGE_APPS,
  SLOT_LOG_PATH,
  SlotError,
  allocateRedisDatabase,
  assertPreviewCapacity,
  assertSlotName,
  caddyAttachCommand,
  caddyDetachCommand,
  caddyIsAttached,
  caddyReloadCommand,
  cloneDatabaseStatements,
  composeProjectName,
  containerAliases,
  databaseAction,
  deregisterSlot,
  dropDatabaseStatements,
  emptyRegistry,
  migrateCommandPlan,
  parseArgs,
  parseRegistry,
  planImageGc,
  planPruneByFreeSpace,
  planSlotDown,
  planSlotReset,
  planSlotUp,
  readRegistry,
  registerSlot,
  renderAskInclude,
  renderIdpRedirectUris,
  renderSlotDownEnv,
  renderSlotEnv,
  renderSlotsInclude,
  resetLogLine,
  runSlotCommand,
  runSlotPlan,
  seedCommandPlan,
  serializeRegistry,
  shortSha,
  slotDatabaseName,
  slotEnvPath,
  slotHostnames,
  slotImageRefs,
  slotNetworkName,
  slotOfImageTag,
} from "./slot.mjs";

const BASE = "stage.doctor.school";
const SHA = "0123456789abcdef0123456789abcdef01234567";

// --- name derivation ---------------------------------------------------------

test("a slot name is `main` or `pr-<N>` and nothing else", () => {
  assert.equal(assertSlotName("main"), "main");
  assert.equal(assertSlotName("pr-2034"), "pr-2034");
  for (const bad of [
    "pr-0",
    "PR-1",
    "pr-1a",
    "pr_1",
    "main; rm -rf /",
    "../main",
    "",
    undefined,
    "prod",
  ]) {
    assert.throws(() => assertSlotName(bad), SlotError, `accepted ${bad}`);
  }
});

test("the compose project and network of a slot are derived from its name", () => {
  assert.equal(composeProjectName("main"), "slot-main");
  assert.equal(composeProjectName("pr-2034"), "slot-pr-2034");
  assert.equal(slotNetworkName("pr-2034"), "slot-pr-2034");
});

test("the slot database name passes the golden-db identifier guard", () => {
  assert.equal(slotDatabaseName("main"), "ds_main");
  assert.equal(slotDatabaseName("pr-2034"), "ds_pr_2034");
  // No dash survives into an identifier that reaches CREATE DATABASE.
  assert.doesNotMatch(slotDatabaseName("pr-2034"), /-/);
});

test("the five hostnames of a slot follow the wildcard record", () => {
  const hosts = slotHostnames("pr-2034", BASE);
  assert.deepEqual(hosts, {
    academy: "academy-pr-2034.stage.doctor.school",
    doctor: "doctor-pr-2034.stage.doctor.school",
    admin: "admin-pr-2034.stage.doctor.school",
    api: "api-pr-2034.stage.doctor.school",
  });
  assert.deepEqual(slotHostnames("main", BASE).academy, [
    "academy-main.stage.doctor.school",
  ][0]);
});

test("a base domain that is not a hostname is refused", () => {
  for (const bad of ["", "not a domain", "stage.doctor.school/", undefined]) {
    assert.throws(() => slotHostnames("main", bad), SlotError);
  }
});

test("container aliases are exactly what the Caddy (slot) snippet dials", () => {
  assert.deepEqual(containerAliases("pr-2034"), {
    api: "pr-2034-api",
    portal: "pr-2034-portal",
    doctor: "pr-2034-doctor",
    admin: "pr-2034-admin",
    centrifugo: "pr-2034-centrifugo",
  });
});

test("image refs are GHCR tags of <slot>-<sha7>, five apps, never a local build", () => {
  const refs = slotImageRefs("pr-2034", SHA);
  assert.deepEqual(Object.keys(refs).sort(), [...SLOT_IMAGE_APPS].sort());
  assert.equal(refs.api, `${GHCR_REPO}/api:pr-2034-0123456`);
  assert.equal(refs["api-migrate"], `${GHCR_REPO}/api-migrate:pr-2034-0123456`);
  assert.equal(refs.doctor, `${GHCR_REPO}/doctor:pr-2034-0123456`);
  assert.equal(shortSha(SHA), "0123456");
});

test("a SHA that is not a full lowercase hex commit id is refused", () => {
  for (const bad of ["0123456", "ZZZ", "", undefined, `${SHA}0`]) {
    assert.throws(() => shortSha(bad), SlotError);
  }
});

// --- Redis database allocation ----------------------------------------------

test("main owns Redis database 0 and a preview never does", () => {
  assert.equal(allocateRedisDatabase("main", emptyRegistry()), 0);
  for (const n of [1, 2, 14, 15, 16, 30, 2034]) {
    const db = allocateRedisDatabase(`pr-${n}`, emptyRegistry());
    assert.ok(db >= 1 && db <= 15, `pr-${n} → ${db}`);
  }
});

test("the Redis database of a preview is deterministic", () => {
  const first = allocateRedisDatabase("pr-2034", emptyRegistry());
  const second = allocateRedisDatabase("pr-2034", emptyRegistry());
  assert.equal(first, second);
});

test("a taken Redis database is probed past, never shared", () => {
  const db = allocateRedisDatabase("pr-2034", emptyRegistry());
  const registry = registerSlot(emptyRegistry(), {
    slot: "pr-19",
    sha: SHA,
    redisDb: db,
    hosts: Object.values(slotHostnames("pr-19", BASE)),
    updatedAt: "2026-09-10T00:00:00.000Z",
  });
  // `1 + (N % 15)` collides for PR numbers 15 apart; the probe moves the newcomer
  // to the next free database instead of dead-ending the converge.
  const probed = allocateRedisDatabase("pr-2034", registry);
  assert.notEqual(probed, db);
  assert.ok(probed >= 1 && probed <= 15);
  // Re-allocating for the slot that already holds it is not a collision.
  assert.equal(allocateRedisDatabase("pr-19", registry), db);
});

test("Redis allocation refuses only when every database 1..15 is held", () => {
  let registry = emptyRegistry();
  for (let db = 1; db <= 15; db += 1) {
    registry = registerSlot(registry, {
      slot: `pr-${100 + db}`,
      sha: SHA,
      redisDb: db,
      hosts: Object.values(slotHostnames(`pr-${100 + db}`, BASE)),
      updatedAt: "2026-09-10T00:00:00.000Z",
    });
  }
  assert.throws(
    () => allocateRedisDatabase("pr-2034", registry),
    (err) => err instanceof SlotError && /no free Redis database/.test(err.message),
  );
});

test("the fourth preview is refused; main never counts against the cap", () => {
  assert.equal(PREVIEW_SLOT_CAP, 3);
  let registry = emptyRegistry();
  for (const slot of ["main", "pr-1", "pr-2", "pr-3"]) {
    registry = registerSlot(registry, {
      slot,
      sha: SHA,
      redisDb: allocateRedisDatabase(slot, registry),
      hosts: Object.values(slotHostnames(slot, BASE)),
      updatedAt: "2026-09-10T00:00:00.000Z",
    });
  }
  assert.throws(() => assertPreviewCapacity("pr-4", registry), SlotError);
  // A slot already registered may be re-converged at the cap.
  assert.doesNotThrow(() => assertPreviewCapacity("pr-3", registry));
  assert.doesNotThrow(() => assertPreviewCapacity("main", registry));
});

// --- database clone ----------------------------------------------------------

test("a preview database is dropped and re-cloned from the golden template", () => {
  const statements = cloneDatabaseStatements("pr-2034");
  assert.match(statements[0], /pg_terminate_backend.*'ds_pr_2034'/);
  assert.equal(statements[1], 'DROP DATABASE IF EXISTS "ds_pr_2034"');
  assert.match(statements[2], /pg_terminate_backend.*'ds_golden'/);
  assert.equal(
    statements[3],
    'CREATE DATABASE "ds_pr_2034" TEMPLATE "ds_golden"',
  );
});

test("main is never cloned and never dropped — it is forward-migrated", () => {
  assert.throws(() => cloneDatabaseStatements("main"), SlotError);
  assert.throws(() => dropDatabaseStatements("main"), SlotError);
  assert.equal(databaseAction({ slot: "main", action: "sync" }), "reuse");
  assert.equal(
    databaseAction({ slot: "main", action: "up", exists: true }),
    "reuse",
  );
  // The very first `up main` has no database yet — bootstrap it from the template.
  assert.equal(
    databaseAction({ slot: "main", action: "up", exists: false }),
    "bootstrap",
  );
  for (const action of ["up", "sync"]) {
    assert.equal(databaseAction({ slot: "pr-2034", action }), "clone");
  }
});

test("the main bootstrap clone is allowed exactly once, through its own seam", () => {
  const statements = cloneDatabaseStatements("main", { bootstrap: true });
  assert.equal(statements.at(-1), 'CREATE DATABASE "ds_main" TEMPLATE "ds_golden"');
  assert.ok(!statements.some((s) => /DROP DATABASE/.test(s)));
});

test("dropping a preview database terminates its backends first", () => {
  const statements = dropDatabaseStatements("pr-2034");
  assert.match(statements[0], /pg_terminate_backend/);
  assert.equal(statements[1], 'DROP DATABASE IF EXISTS "ds_pr_2034"');
});

// --- migrate + branch seed ---------------------------------------------------

test("migrate and the branch golden seed run in the slot's own migrate image", () => {
  const migrate = migrateCommandPlan("pr-2034");
  const seed = seedCommandPlan("pr-2034");
  for (const plan of [migrate, seed]) {
    assert.equal(plan.command[0], "docker");
    assert.deepEqual(plan.command.slice(0, 2), ["docker", "compose"]);
    assert.ok(plan.command.includes("--profile"));
    assert.ok(plan.command.includes("run"));
    assert.ok(plan.command.includes("--rm"));
    assert.ok(plan.command.includes("migrate"));
    assert.ok(plan.command.includes("slot-pr-2034"));
    // Nothing pnpm-shaped may run on the HOST (spec §3 «Host runtime»).
    assert.notEqual(plan.command[0], "pnpm");
  }
  assert.deepEqual(migrate.command.slice(-3), [
    "pnpm",
    "run",
    "drizzle:migrate:ci",
  ]);
  assert.deepEqual(seed.command.slice(-5), [
    "pnpm",
    "--filter",
    "@ds/db",
    "run",
    "seed:golden",
  ]);
});

// --- Caddy attach/detach + reload -------------------------------------------

test("Caddy's attachment is planned as verify-then-act in BOTH directions", () => {
  const attach = caddyAttachCommand("pr-2034");
  const detach = caddyDetachCommand("pr-2034");
  assert.equal(attach.kind, "ensure-present");
  assert.equal(detach.kind, "ensure-absent");
  // Neither direction is tolerated: the expected no-op is decided by the PROBE, so a
  // connect/disconnect that actually runs and fails is a real failure.
  assert.ok(!attach.tolerateFailure);
  assert.ok(!detach.tolerateFailure);
  assert.deepEqual(attach.items[0].apply, [
    "docker",
    "network",
    "connect",
    "slot-pr-2034",
    CADDY_CONTAINER,
  ]);
  assert.deepEqual(detach.items[0].remove, [
    "docker",
    "network",
    "disconnect",
    "slot-pr-2034",
    CADDY_CONTAINER,
  ]);
  // One probe answers both questions.
  assert.deepEqual(attach.items[0].probe, detach.items[0].probe);
  assert.deepEqual(attach.items[0].probe, [
    "docker",
    "network",
    "inspect",
    "slot-pr-2034",
    "--format",
    "{{json .Containers}}",
  ]);
});

test("the attachment probe is read for CONTENT, not for its exit status", () => {
  assert.equal(
    caddyIsAttached(
      JSON.stringify({
        "9f0": { Name: CADDY_CONTAINER },
        a1b: { Name: "pr-2034-portal-1" },
      }),
    ),
    true,
  );
  assert.equal(
    caddyIsAttached(JSON.stringify({ a1b: { Name: "pr-2034-portal-1" } })),
    false,
  );
  // A network with nothing attached prints an empty map; docker prints nothing at all
  // for a format that resolves to no value.
  assert.equal(caddyIsAttached("{}"), false);
  assert.equal(caddyIsAttached("   "), false);
  // Output that is not the documented shape is an anomaly, never a silent «absent».
  assert.throws(() => caddyIsAttached("<html>"), SlotError);
});

test("the reload goes through the container's own admin API, never a restart", () => {
  const { command } = caddyReloadCommand();
  assert.deepEqual(command, [
    "docker",
    "exec",
    CADDY_CONTAINER,
    "caddy",
    "reload",
    "--config",
    "/etc/caddy/Caddyfile",
  ]);
  assert.ok(!command.includes("restart"));
});

// --- the registry and the rendered Caddy includes ----------------------------

test("an absent or empty registry file reads as an empty registry", () => {
  assert.deepEqual(parseRegistry(""), emptyRegistry());
  assert.deepEqual(parseRegistry(null), emptyRegistry());
  assert.deepEqual(parseRegistry('{"slots":{}}'), emptyRegistry());
  assert.throws(() => parseRegistry("{not json"), SlotError);
});

test("register and deregister are pure — the input registry is untouched", () => {
  const before = emptyRegistry();
  const after = registerSlot(before, {
    slot: "pr-7",
    sha: SHA,
    redisDb: 7,
    hosts: Object.values(slotHostnames("pr-7", BASE)),
    updatedAt: "2026-09-10T00:00:00.000Z",
  });
  assert.deepEqual(before, emptyRegistry());
  assert.equal(after.slots["pr-7"].sha, SHA);
  assert.deepEqual(deregisterSlot(after, "pr-7"), emptyRegistry());
  assert.deepEqual(deregisterSlot(emptyRegistry(), "pr-7"), emptyRegistry());
  assert.match(serializeRegistry(after), /"pr-7"/);
});

test("the ask include answers 200 for registered hosts and for the shared IdP only", () => {
  const registry = registerSlot(emptyRegistry(), {
    slot: "pr-7",
    sha: SHA,
    redisDb: 7,
    hosts: Object.values(slotHostnames("pr-7", BASE)),
    updatedAt: "2026-09-10T00:00:00.000Z",
  });
  const rendered = renderAskInclude(registry, { baseDomain: BASE });
  assert.match(rendered, /domain=id\.stage\.doctor\.school/);
  assert.match(rendered, /domain=academy-pr-7\.stage\.doctor\.school/);
  assert.match(rendered, /domain=api-pr-7\.stage\.doctor\.school/);
  assert.match(rendered, /^respond @registered 200$/m);
  // An unregistered slot never appears — that is what bounds ACME.
  assert.doesNotMatch(rendered, /pr-8/);
  // Generated: a hand edit is a bug, so the file says so.
  assert.match(rendered, /^# generated by tools\/staging\/slot\.mjs/m);
});

test("an EMPTY registry still renders includes Caddy can parse", () => {
  const ask = renderAskInclude(emptyRegistry(), { baseDomain: BASE });
  const slots = renderSlotsInclude(emptyRegistry());
  // The IdP host is registered unconditionally — it is not a slot.
  assert.match(ask, /domain=id\.stage\.doctor\.school/);
  assert.match(ask, /respond @registered 200/);
  // No slot lines, but a parseable file (comments only).
  assert.ok(!/import slot/.test(slots));
  for (const line of slots.split("\n")) {
    assert.ok(line === "" || line.startsWith("#"), `stray line: ${line}`);
  }
});

test("the slots include imports exactly the registered slots, sorted", () => {
  let registry = emptyRegistry();
  for (const slot of ["pr-9", "main", "pr-2"]) {
    registry = registerSlot(registry, {
      slot,
      sha: SHA,
      redisDb: allocateRedisDatabase(slot, registry),
      hosts: Object.values(slotHostnames(slot, BASE)),
      updatedAt: "2026-09-10T00:00:00.000Z",
    });
  }
  const lines = renderSlotsInclude(registry)
    .split("\n")
    .filter((line) => line.startsWith("import"));
  assert.deepEqual(lines, [
    "import slot main",
    "import slot pr-2",
    "import slot pr-9",
  ]);
});

test("ask and slots are rendered from the SAME registry — they cannot drift", () => {
  const registry = registerSlot(emptyRegistry(), {
    slot: "pr-3",
    sha: SHA,
    redisDb: 3,
    hosts: Object.values(slotHostnames("pr-3", BASE)),
    updatedAt: "2026-09-10T00:00:00.000Z",
  });
  const ask = renderAskInclude(registry, { baseDomain: BASE });
  const slots = renderSlotsInclude(registry);
  for (const slot of Object.keys(registry.slots)) {
    assert.ok(slots.includes(`import slot ${slot}`));
    for (const host of registry.slots[slot].hosts) {
      assert.ok(ask.includes(`domain=${host}`), `${host} missing from ask`);
    }
  }
});

// --- the per-slot env file ---------------------------------------------------

test("the per-slot env file carries no secret — the password stays in stage.env", () => {
  const env = renderSlotEnv({
    slot: "pr-2034",
    sha: SHA,
    baseDomain: BASE,
    redisDb: 4,
  });
  assert.doesNotMatch(env, /PASSWORD/);
  assert.doesNotMatch(env, /DATABASE_URL/); // built by compose from POSTGRES_PASSWORD
  assert.match(env, /^SLOT=pr-2034$/m);
  assert.match(env, /^SLOT_SHA7=0123456$/m);
  assert.match(env, new RegExp(`^DEPLOY_SHA=${SHA}$`, "m"));
  assert.match(env, /^SLOT_DB=ds_pr_2034$/m);
  assert.match(env, /^REDIS_URL=redis:\/\/redis:6379\/4$/m);
  assert.match(
    env,
    /^CENTRIFUGO_URL=https:\/\/api-pr-2034\.stage\.doctor\.school$/m,
  );
  assert.match(env, /^IDP_ISSUER=https:\/\/id\.stage\.doctor\.school$/m);
  assert.match(
    env,
    /^IDP_REDIRECT_URI=https:\/\/api-pr-2034\.stage\.doctor\.school\/auth\/callback$/m,
  );
  assert.match(
    env,
    /^MAILER_PORTAL_BASE_URL=https:\/\/academy-pr-2034\.stage\.doctor\.school$/m,
  );
  // Sink partitioning is by sender local part (spec §3 «Sink partitioning»).
  assert.match(
    env,
    /^MAILER_SMTP_FROM=no-reply\+pr-2034@stage\.doctor\.school$/m,
  );
  assert.equal(slotEnvPath("pr-2034"), `${SLOT_ENV_DIR}/pr-2034.env`);
});

test("main's Redis database is 0 in the env file it gets", () => {
  const env = renderSlotEnv({
    slot: "main",
    sha: SHA,
    baseDomain: BASE,
    redisDb: 0,
  });
  assert.match(env, /^REDIS_URL=redis:\/\/redis:6379\/0$/m);
  assert.match(env, /^SLOT_DB=ds_main$/m);
});

// --- gc ----------------------------------------------------------------------

test("a slot-tagged image names the slot that owns it", () => {
  assert.equal(slotOfImageTag("pr-2034-0123456"), "pr-2034");
  assert.equal(slotOfImageTag("main-0123456"), "main");
  for (const bad of ["latest", "local", "pr-2034", "", undefined]) {
    assert.equal(slotOfImageTag(bad), null);
  }
});

test("gc removes images of unregistered slots and keeps every live one", () => {
  const registry = registerSlot(emptyRegistry(), {
    slot: "pr-3",
    sha: SHA,
    redisDb: 3,
    hosts: Object.values(slotHostnames("pr-3", BASE)),
    updatedAt: "2026-09-10T00:00:00.000Z",
  });
  const images = [
    `${GHCR_REPO}/api:pr-3-0123456`,
    `${GHCR_REPO}/portal:pr-3-0123456`,
    `${GHCR_REPO}/api:pr-9-bbbbbbb`,
    `${GHCR_REPO}/api:main-ccccccc`,
    "caddy:2.11.4-alpine",
  ];
  const plan = planImageGc({ images, registry });
  assert.deepEqual(plan.remove, [
    `${GHCR_REPO}/api:pr-9-bbbbbbb`,
    `${GHCR_REPO}/api:main-ccccccc`,
  ]);
  // Non-slot images (the shared infra) are never touched by gc.
  assert.ok(!plan.remove.includes("caddy:2.11.4-alpine"));
  // Verify-then-remove, like the teardown: an image another gc already took is the
  // desired end state, and one that refuses to go is a hard failure.
  assert.equal(plan.commands[0].kind, "ensure-absent");
  assert.ok(!plan.commands[0].tolerateFailure);
  assert.deepEqual(
    plan.commands[0].items.map((item) => item.remove.at(-1)),
    plan.remove,
  );
});

test("gc never invokes buildx — this box builds nothing", () => {
  const plan = planImageGc({ images: [], registry: emptyRegistry() });
  const prune = planPruneByFreeSpace({ freeBytes: 1 });
  for (const step of [...plan.commands, ...prune.commands]) {
    assert.ok(!step.command.includes("buildx"), step.command.join(" "));
    assert.ok(!step.command.includes("build"), step.command.join(" "));
    // The prune is idempotent on its own — nothing to reclaim exits 0 — so it needs
    // no tolerance either, and a prune that fails is a real docker failure.
    assert.ok(!step.tolerateFailure);
  }
});

test("the unconditional prune only fires below the 10GB free-disk floor", () => {
  assert.equal(GC_FREE_SPACE_FLOOR_BYTES, 10 * 1024 ** 3);
  const above = planPruneByFreeSpace({
    freeBytes: GC_FREE_SPACE_FLOOR_BYTES + 1,
  });
  assert.deepEqual(above.commands, []);
  const below = planPruneByFreeSpace({
    freeBytes: GC_FREE_SPACE_FLOOR_BYTES - 1,
  });
  assert.deepEqual(below.commands[0].command, [
    "docker",
    "image",
    "prune",
    "-af",
    "--filter",
    "until=24h",
  ]);
});

// --- the ordered plans -------------------------------------------------------

function planLabels(plan) {
  return plan.steps.map((step) => step.label);
}

test("up: env file → clone → pull → migrate → seed → up → attach → register → reload", () => {
  const plan = planSlotUp({
    slot: "pr-2034",
    sha: SHA,
    registry: emptyRegistry(),
    baseDomain: BASE,
    action: "up",
  });
  assert.deepEqual(planLabels(plan), [
    "write slot env",
    "clone database",
    "pull images",
    "migrate",
    "seed:golden",
    "up -d",
    "attach caddy",
    "write registry",
    "render caddy includes",
    "reload caddy",
  ]);
  // The registry write happens only after the containers are up: a host that is
  // registered before its upstream exists gets a certificate for a 502.
  assert.ok(
    planLabels(plan).indexOf("write registry") >
      planLabels(plan).indexOf("up -d"),
  );
  assert.equal(plan.redisDb, allocateRedisDatabase("pr-2034", emptyRegistry()));
  assert.ok(
    plan.steps.some(
      (step) => step.kind === "sh" && step.command.includes("pull"),
    ),
  );
  // Nothing in the plan builds an image on the box.
  for (const step of plan.steps) {
    if (step.kind !== "sh") continue;
    assert.ok(!step.command.includes("build"), step.command.join(" "));
  }
});

test("sync of main forward-migrates and never clones or seeds a fresh database", () => {
  const registry = registerSlot(emptyRegistry(), {
    slot: "main",
    sha: SHA,
    redisDb: 0,
    hosts: Object.values(slotHostnames("main", BASE)),
    updatedAt: "2026-09-10T00:00:00.000Z",
  });
  const plan = planSlotUp({
    slot: "main",
    sha: "89abcdef89abcdef89abcdef89abcdef89abcdef",
    registry,
    baseDomain: BASE,
    action: "sync",
  });
  assert.ok(!planLabels(plan).includes("clone database"));
  assert.ok(planLabels(plan).includes("migrate"));
  for (const step of plan.steps) {
    if (step.kind !== "sql") continue;
    assert.doesNotMatch(step.statement, /DROP DATABASE/);
    assert.doesNotMatch(step.statement, /TEMPLATE/);
  }
});

test("down: detach → compose down -v → drop database → deregister → reload → images", () => {
  const registry = registerSlot(emptyRegistry(), {
    slot: "pr-2034",
    sha: SHA,
    redisDb: 4,
    hosts: Object.values(slotHostnames("pr-2034", BASE)),
    updatedAt: "2026-09-10T00:00:00.000Z",
  });
  const plan = planSlotDown({ slot: "pr-2034", registry, baseDomain: BASE });
  assert.deepEqual(planLabels(plan), [
    "ensure slot env",
    "detach caddy",
    "write registry",
    "render caddy includes",
    "reload caddy",
    "compose down",
    "remove slot network",
    "drop database",
    "remove slot images",
    "remove slot env",
  ]);
  // Deregistration precedes teardown: a host must stop being certifiable before
  // its upstream disappears.
  assert.ok(
    planLabels(plan).indexOf("reload caddy") <
      planLabels(plan).indexOf("compose down"),
  );
  const composeDown = plan.steps.find((step) => step.label === "compose down");
  assert.ok(composeDown.command.includes("-v"));
  assert.equal(plan.registry.slots["pr-2034"], undefined);
});

test("down of main tears the containers down but keeps its persistent database", () => {
  const registry = registerSlot(emptyRegistry(), {
    slot: "main",
    sha: SHA,
    redisDb: 0,
    hosts: Object.values(slotHostnames("main", BASE)),
    updatedAt: "2026-09-10T00:00:00.000Z",
  });
  const plan = planSlotDown({ slot: "main", registry, baseDomain: BASE });
  assert.ok(!planLabels(plan).includes("drop database"));
  const composeDown = plan.steps.find((step) => step.label === "compose down");
  assert.ok(!composeDown.command.includes("-v"));
});

// --- the executor ------------------------------------------------------------

test("the executor runs every step in order through injected effects", async () => {
  const seen = [];
  const plan = planSlotUp({
    slot: "pr-2034",
    sha: SHA,
    registry: emptyRegistry(),
    baseDomain: BASE,
    action: "up",
  });
  await runSlotPlan(plan, {
    sql: (statement) => seen.push(["sql", statement]),
    sh: (command) => seen.push(["sh", command.join(" ")]),
    // Caddy is not on the fresh slot's network yet, so the attach runs.
    probe: (command) => {
      seen.push(["probe", command.join(" ")]);
      return { ok: true, stdout: "{}" };
    },
    write: (path) => seen.push(["write", path]),
  });
  assert.equal(seen[0][0], "write");
  assert.equal(seen[0][1], `${SLOT_ENV_DIR}/pr-2034.env`);
  assert.ok(seen.some(([kind, arg]) => kind === "write" && arg === REGISTRY_PATH));
  assert.ok(
    seen.some(
      ([kind, arg]) => kind === "write" && arg === `${CADDY_INCLUDE_DIR}/ask.caddy`,
    ),
  );
  assert.ok(
    seen.some(([kind, arg]) => kind === "sql" && /CREATE DATABASE/.test(arg)),
  );
});

test("a failing step aborts the run", async () => {
  const plan = planSlotUp({
    slot: "pr-2034",
    sha: SHA,
    registry: emptyRegistry(),
    baseDomain: BASE,
    action: "up",
  });
  await assert.rejects(
    runSlotPlan(plan, {
      sql: () => {},
      sh: (command) => {
        if (command.includes("pull")) throw new Error("manifest unknown");
        return undefined;
      },
      write: () => {},
    }),
    /manifest unknown/,
  );

  // A re-converge finds Caddy already attached: the probe says so, `connect` is never
  // issued, and the rest of the plan runs. (`sh` would throw if it ever were.)
  let reached = false;
  await runSlotPlan(plan, {
    sql: () => {},
    sh: (command) => {
      if (command.includes("connect")) throw new Error("already exists");
      if (command.includes("reload")) reached = true;
      return undefined;
    },
    probe: () => ({
      ok: true,
      stdout: JSON.stringify({ c9: { Name: CADDY_CONTAINER } }),
    }),
    write: () => {},
  });
  assert.equal(reached, true);
});

// --- the CLI surface ---------------------------------------------------------

test("the CLI parses the commands step 4 part 1 actually implements", () => {
  assert.deepEqual(parseArgs(["up", "pr-2034", SHA]), {
    command: "up",
    slot: "pr-2034",
    sha: SHA,
  });
  assert.deepEqual(parseArgs(["down", "pr-2034"]), {
    command: "down",
    slot: "pr-2034",
    sha: undefined,
  });
  assert.deepEqual(parseArgs(["status"]), {
    command: "status",
    slot: undefined,
    sha: undefined,
  });
  assert.deepEqual(parseArgs(["render"]), {
    command: "render",
    slot: undefined,
    sha: undefined,
  });
  assert.throws(() => parseArgs(["up", "pr-2034"]), SlotError);
  assert.throws(() => parseArgs(["frobnicate"]), SlotError);
  assert.throws(() => parseArgs([]), SlotError);
});

test("reset-identities refuses loudly instead of silently doing nothing", () => {
  // `reset` landed in part 2a (see the section at the end of this file); the
  // redirect-URI convergence this command needs is part 2b's, and until it exists a
  // silent no-op would look to the suite like a converged identity set.
  assert.throws(
    () => parseArgs(["reset-identities", "pr-2034"]),
    (err) => err instanceof SlotError && /not implemented until part 2b/.test(err.message),
  );
});

// --- the IdP redirect-URI set (Mode (a) #2168) --------------------------------

test("the IdP redirect set covers every registered slot, ordered and de-duplicated", () => {
  let registry = registerSlot(emptyRegistry(), {
    slot: "pr-2034",
    sha: SHA,
    redisDb: 4,
    hosts: Object.values(slotHostnames("pr-2034", BASE)),
    updatedAt: "2026-09-10T00:00:00.000Z",
  });
  registry = registerSlot(registry, {
    slot: "main",
    sha: SHA,
    redisDb: 0,
    hosts: Object.values(slotHostnames("main", BASE)),
    updatedAt: "2026-09-10T00:00:00.000Z",
  });

  const set = renderIdpRedirectUris(registry, BASE);
  // Ordered `main` first, then previews — the whole-set write stays diffable.
  assert.deepEqual(set.redirectUris, [
    "https://api-main.stage.doctor.school/auth/callback",
    "https://api-pr-2034.stage.doctor.school/auth/callback",
  ]);
  assert.deepEqual(set.postLogoutUris, [
    "https://academy-main.stage.doctor.school",
    "https://doctor-main.stage.doctor.school",
    "https://admin-main.stage.doctor.school",
    "https://academy-pr-2034.stage.doctor.school",
    "https://doctor-pr-2034.stage.doctor.school",
    "https://admin-pr-2034.stage.doctor.school",
  ]);
  // The path is exactly the one the per-slot env file hands the api.
  const env = renderSlotEnv({
    slot: "pr-2034",
    sha: SHA,
    baseDomain: BASE,
    redisDb: 4,
  });
  const perSlot = /^IDP_REDIRECT_URI=(.+)$/m.exec(env)[1];
  assert.ok(set.redirectUris.includes(perSlot));
});

test("an empty registry yields an empty redirect set, never a wildcard", () => {
  const set = renderIdpRedirectUris(emptyRegistry(), BASE);
  assert.deepEqual(set.redirectUris, []);
  assert.deepEqual(set.postLogoutUris, []);
  assert.throws(
    () => renderIdpRedirectUris(emptyRegistry(), "not a domain"),
    SlotError,
  );
});

// --- teardown survives a missing env file and takes the network with it -------

test("down re-renders the slot env file first, so a deleted one cannot block compose", () => {
  const registry = registerSlot(emptyRegistry(), {
    slot: "pr-2034",
    sha: SHA,
    redisDb: 4,
    hosts: Object.values(slotHostnames("pr-2034", BASE)),
    updatedAt: "2026-09-10T00:00:00.000Z",
  });
  const plan = planSlotDown({ slot: "pr-2034", registry, baseDomain: BASE });
  const labels = planLabels(plan);
  assert.equal(labels[0], "ensure slot env");
  assert.ok(labels.indexOf("ensure slot env") < labels.indexOf("compose down"));
  const ensure = plan.steps[0];
  assert.equal(ensure.path, `${SLOT_ENV_DIR}/pr-2034.env`);
  assert.match(ensure.contents, /^SLOT_DB=ds_pr_2034$/m);
});

test("a slot missing from the registry still renders enough env to be torn down", () => {
  const contents = renderSlotDownEnv({
    slot: "pr-2034",
    entry: undefined,
    baseDomain: BASE,
  });
  assert.match(contents, /^SLOT=pr-2034$/m);
  assert.match(contents, /^SLOT_DB=ds_pr_2034$/m);
  assert.match(contents, /^SLOT_SHA7=/m);
  assert.doesNotMatch(contents, /PASSWORD/);

  const plan = planSlotDown({
    slot: "pr-2034",
    registry: emptyRegistry(),
    baseDomain: BASE,
  });
  assert.equal(planLabels(plan)[0], "ensure slot env");
});

test("down removes the slot network after the detach, and never before compose down", () => {
  const registry = registerSlot(emptyRegistry(), {
    slot: "pr-2034",
    sha: SHA,
    redisDb: 4,
    hosts: Object.values(slotHostnames("pr-2034", BASE)),
    updatedAt: "2026-09-10T00:00:00.000Z",
  });
  const labels = planLabels(
    planSlotDown({ slot: "pr-2034", registry, baseDomain: BASE }),
  );
  assert.ok(labels.includes("remove slot network"));
  assert.ok(labels.indexOf("compose down") < labels.indexOf("remove slot network"));
  assert.ok(labels.indexOf("detach caddy") < labels.indexOf("remove slot network"));
});

// --- absent is not a failure --------------------------------------------------
//
// Compose owns `slot-<slot>` (infra/deploy/compose/slot/compose.yml), so a healthy
// `compose down` takes the network with it and the follow-up `docker network rm`
// says «not found». Treating that as a tolerated failure made a SUCCESSFUL teardown
// exit non-zero. The removals below verify first and only then remove.

function downPlan(slot = "pr-2034") {
  const registry = registerSlot(emptyRegistry(), {
    slot,
    sha: SHA,
    redisDb: 4,
    hosts: Object.values(slotHostnames(slot, BASE)),
    updatedAt: "2026-09-10T00:00:00.000Z",
  });
  return planSlotDown({ slot, registry, baseDomain: BASE });
}

test("the network and image removals are planned as verify-then-remove steps", () => {
  const plan = downPlan();
  for (const label of ["remove slot network", "remove slot images"]) {
    const step = plan.steps.find((candidate) => candidate.label === label);
    assert.equal(step.kind, "ensure-absent");
    assert.ok(!step.tolerateFailure, `${label} must not be a tolerated failure`);
    assert.ok(step.items.length >= 1);
    for (const item of step.items) {
      assert.ok(item.probe.includes("inspect"));
      assert.ok(item.remove.includes("rm"));
    }
  }
});

test("a network compose already removed leaves `down` clean and skips `network rm`", async () => {
  const seen = [];
  await runSlotPlan(downPlan(), {
    sql: () => {},
    sh: (command) => {
      seen.push(command.join(" "));
      return undefined;
    },
    probe: (command) => {
      seen.push(command.join(" "));
      return { ok: false, stdout: "", stderr: "Error: No such network: slot-pr-2034" };
    },
    write: () => {},
  });
  // Nothing is there, so nothing is removed — and the run does not fail.
  assert.ok(!seen.some((command) => /network rm/.test(command)));
  assert.ok(!seen.some((command) => /image rm/.test(command)));
  assert.ok(!seen.some((command) => /network disconnect/.test(command)));
});

test("a network that is still there IS removed, and a failing removal fails `down`", async () => {
  const seen = [];
  await assert.rejects(
    runSlotPlan(downPlan(), {
      sql: () => {},
      sh: (command) => {
        seen.push(command.join(" "));
        if (command.includes("rm") && command.includes("network")) {
          throw new Error("network slot-pr-2034 has active endpoints");
        }
        return undefined;
      },
      probe: (command) => {
        seen.push(command.join(" "));
        // The network is there with nothing attached to it any more.
        return { ok: true, stdout: "{}" };
      },
      write: () => {},
    }),
    /active endpoints/,
  );
  assert.ok(seen.some((command) => /network inspect/.test(command)));
  assert.ok(seen.some((command) => /network rm/.test(command)));
});

test("an injected probe effect decides presence without going through `sh`", async () => {
  const probed = [];
  const seen = [];
  const result = await runSlotPlan(downPlan(), {
    sql: () => {},
    sh: (command) => seen.push(command.join(" ")),
    probe: (command) => {
      probed.push(command.join(" "));
      return { ok: false, stdout: "", stderr: "No such network" };
    },
    write: () => {},
  });
  assert.ok(probed.some((command) => /network inspect/.test(command)));
  assert.ok(!seen.some((command) => /network rm/.test(command)));
  assert.equal(result.slot, "pr-2034");
});

// --- the CLI command branches -------------------------------------------------
//
// The regression these lock: `sync` (and a second `up`) exited non-zero on a slot
// that had genuinely converged, because `docker network connect` reports «endpoint
// already exists» on a re-attach. No plan-level test could see it — it only appears
// when the command branch itself runs — so these drive `runSlotCommand` end to end
// with injected effects. `preview.yml` re-runs `sync` on every push to an open PR,
// so «green means converged» is the whole contract of this surface.

function liveRegistry(slot = "pr-2034") {
  return registerSlot(emptyRegistry(), {
    slot,
    sha: SHA,
    redisDb: 4,
    hosts: Object.values(slotHostnames(slot, BASE)),
    updatedAt: "2026-09-10T00:00:00.000Z",
  });
}

function recordingEffects({ attached = false, connectFails = false } = {}) {
  const seen = [];
  const effects = {
    sql: () => {},
    sh: (command) => {
      seen.push(command.join(" "));
      if (connectFails && command.includes("connect")) {
        throw new Error(
          "Error response from daemon: endpoint with name stg-infra-caddy-1 already exists in network slot-pr-2034",
        );
      }
      return undefined;
    },
    probe: (command) => {
      seen.push(command.join(" "));
      if (command.includes("network") && command.includes("inspect")) {
        return {
          ok: true,
          stdout: JSON.stringify(attached ? { c9: { Name: CADDY_CONTAINER } } : {}),
        };
      }
      // Images and everything else: absent.
      return { ok: false, stdout: "", stderr: "No such object" };
    },
    write: () => {},
  };
  return { seen, effects };
}

test("a fresh `up` attaches Caddy and exits 0", async () => {
  const { seen, effects } = recordingEffects({ attached: false });
  const line = await runSlotCommand({
    options: { command: "up", slot: "pr-2034", sha: SHA },
    registry: emptyRegistry(),
    baseDomain: BASE,
    effects,
  });
  assert.ok(seen.some((command) => /network connect slot-pr-2034/.test(command)));
  assert.match(line, /converged/);
});

test("`sync` on an already attached slot never issues the connect, and exits 0", async () => {
  // `connectFails` is the point: were the connect still issued, this would reject with
  // the very «already exists» that made every routine preview refresh red.
  const { seen, effects } = recordingEffects({ attached: true, connectFails: true });
  const line = await runSlotCommand({
    options: { command: "sync", slot: "pr-2034", sha: SHA },
    registry: liveRegistry(),
    baseDomain: BASE,
    effects,
  });
  assert.ok(!seen.some((command) => /network connect/.test(command)));
  assert.match(line, /converged/);
});

test("a connect that actually runs and fails fails `up`", async () => {
  const { effects } = recordingEffects({ attached: false, connectFails: true });
  await assert.rejects(
    runSlotCommand({
      options: { command: "up", slot: "pr-2034", sha: SHA },
      registry: emptyRegistry(),
      baseDomain: BASE,
      effects,
    }),
    /already exists in network/,
  );
});

test("`down` on a slot whose Caddy was never attached exits 0 without disconnecting", async () => {
  const { seen, effects } = recordingEffects({ attached: false });
  const line = await runSlotCommand({
    options: { command: "down", slot: "pr-2034" },
    registry: liveRegistry(),
    baseDomain: BASE,
    effects,
  });
  assert.ok(!seen.some((command) => /network disconnect/.test(command)));
  assert.match(line, /is down/);
});

test("a disconnect that actually runs and fails fails `down`", async () => {
  const { effects } = recordingEffects({ attached: true });
  const sh = effects.sh;
  effects.sh = (command) => {
    if (command.includes("disconnect")) throw new Error("permission denied");
    return sh(command);
  };
  await assert.rejects(
    runSlotCommand({
      options: { command: "down", slot: "pr-2034" },
      registry: liveRegistry(),
      baseDomain: BASE,
      effects,
    }),
    /permission denied/,
  );
});

// --- `reset main` and the lazy database probe (part 2a) -----------------------
//
// The regressions these lock: `reset` never runs without `--yes`, never touches a
// preview (whose every converge already re-clones it) and never drops `ds_golden`;
// the audit line lands BEFORE the destructive SQL; and `slot down main` no longer
// reaches into Postgres for an answer its plan never asks for — that probe cost a
// `docker exec … psql` round trip on every teardown (Mode (a) NIT, PR #2168).

test("`reset` refuses without `--yes`", () => {
  assert.throws(() => parseArgs(["reset", "main"]), /--yes/);
  assert.deepEqual(parseArgs(["reset", "main", "--yes"]), {
    command: "reset",
    slot: "main",
    sha: undefined,
    yes: true,
  });
});

test("only `main` is resettable — a preview's every converge already re-clones it", () => {
  assert.throws(() => parseArgs(["reset", "pr-5", "--yes"]), /only `main` is resettable/);
  assert.throws(() => parseArgs(["reset"]), /requires <slot>/);
  assert.throws(() => parseArgs(["reset", "main", "--force"]), /unknown option/);
});

test("`reset-identities` still refuses, and now names part 2b", () => {
  assert.throws(() => parseArgs(["reset-identities", "pr-5"]), /part 2b/);
});

test("`reset main` audits first, then drops and re-clones `ds_main` — never `ds_golden`", () => {
  const registry = registerSlot(emptyRegistry(), {
    slot: "main",
    sha: SHA,
    redisDb: 0,
    hosts: Object.values(slotHostnames("main", BASE)),
    updatedAt: "2026-09-10T00:00:00.000Z",
  });
  const plan = planSlotReset({ registry, baseDomain: BASE, actor: "anton" });

  assert.equal(plan.steps[0].kind, "append");
  assert.equal(plan.steps[0].path, SLOT_LOG_PATH);
  assert.match(plan.steps[0].contents, /reset main by anton sha=0123456789abcdef/);

  const sql = plan.steps[1].statements.join("\n");
  assert.match(sql, /DROP DATABASE IF EXISTS "ds_main"/);
  assert.match(sql, /CREATE DATABASE "ds_main" TEMPLATE "ds_golden"/);
  assert.ok(!/DROP DATABASE IF EXISTS "ds_golden"/.test(sql));

  // Exactly one clone: the converge that follows must not emit a second one.
  const clones = plan.steps.filter(
    (step) => step.kind === "sql" && /CREATE DATABASE/.test(step.statements.join(" ")),
  );
  assert.equal(clones.length, 1);
  assert.equal(plan.sha, SHA);
});

test("`reset main` refuses on a box where `main` is not registered", () => {
  assert.throws(
    () => planSlotReset({ registry: emptyRegistry(), baseDomain: BASE }),
    /not in the registry/,
  );
});

test("the audit line names the human, the moment and the SHA", () => {
  const line = resetLogLine({ actor: "anton", sha: SHA, now: new Date("2026-09-10T12:00:00Z") });
  assert.equal(line, `2026-09-10T12:00:00.000Z reset main by anton sha=${SHA}\n`);
  assert.match(resetLogLine({ actor: undefined, sha: SHA }), /by unknown /);
});

test("an `append` step refuses a `write`-only effect set rather than truncating the trail", async () => {
  await assert.rejects(
    runSlotPlan(
      { steps: [{ kind: "append", label: "audit", path: SLOT_LOG_PATH, contents: "x" }] },
      { sql: () => {}, sh: () => {}, write: () => {} },
    ),
    /needs an `append` effect/,
  );
});

test("`down main` never asks Postgres whether `ds_main` exists", async () => {
  let asked = false;
  const { effects } = recordingEffects({ attached: false });
  await runSlotCommand({
    options: { command: "down", slot: "main" },
    registry: liveRegistry("main"),
    baseDomain: BASE,
    effects,
    databaseExists: () => {
      asked = true;
      return true;
    },
  });
  assert.equal(asked, false);
});

test("`up main` asks exactly once, lazily, through the thunk", async () => {
  let asks = 0;
  const { effects } = recordingEffects({ attached: false });
  await runSlotCommand({
    options: { command: "up", slot: "main", sha: SHA },
    registry: emptyRegistry(),
    baseDomain: BASE,
    effects,
    databaseExists: () => {
      asks += 1;
      return false;
    },
  });
  assert.equal(asks, 1);
});

test("`up pr-<N>` never asks — a preview is cloned regardless of what exists", async () => {
  let asked = false;
  const { effects } = recordingEffects({ attached: false });
  await runSlotCommand({
    options: { command: "up", slot: "pr-2034", sha: SHA },
    registry: emptyRegistry(),
    baseDomain: BASE,
    effects,
    databaseExists: () => {
      asked = true;
      return true;
    },
  });
  assert.equal(asked, false);
});

test("`readRegistry` is exported so the deployer reads the SAME file through the SAME parser", () => {
  assert.equal(typeof readRegistry, "function");
});
