#!/usr/bin/env node
// tools/staging/slot.mjs — the slot deployer's hands on `stage-1` (Issue #2064,
// staging tech spec 2026-09-08 §3 «Slots» / §5 «Converge» / §8 step 4).
//
// A SLOT is one compose project running the product service set (`api`, `portal`,
// `doctor`, `admin`, `centrifugo`, plus a `migrate` one-shot) from images the
// preview workflow built on a GitHub-hosted runner and pushed to GHCR. The box
// PULLS; it never builds — `docker build` and `buildx` appear nowhere in this file,
// and the tests assert that.
//
// What this module owns:
//   * name derivation — slot → compose project, network, database, hostnames,
//     container aliases, image refs. Every name is derived, never passed in, so a
//     slot cannot be addressed two ways;
//   * the slot REGISTRY (`/var/lib/ds-platform/slots.json`) and the two Caddy
//     include files rendered from it. The `ask` endpoint (on-demand TLS gate) and
//     the `import slot <name>` lines come from ONE source, so a hostname can never
//     be certifiable while no slot serves it, nor the reverse;
//   * the ordered plans for `up` / `sync` / `down` / `gc`, returned as DATA. The
//     effects (`sql`, `sh`, `write`) are injected — `main()` is the only place that
//     touches Postgres, Docker or the filesystem.
//
// Style and guards are `golden-db.mjs`'s: pure planners, one injected executor, a
// thin CLI behind `invokedDirectly`. Database identifiers reuse that module's
// `DB_NAME_RE` / `assertDatabaseName` / `terminateBackendsStatement` rather than a
// second, subtly different guard.
//
// `reset main` (part 2a) drops `ds_main`, re-clones it from `ds_golden` and re-runs
// the ordinary converge on the registered SHA; it refuses without `--yes` and appends
// one audit line per run. `reset-identities` is still NOT here — part 2b owns the
// redirect-URI convergence onto the shared Zitadel app, and until it lands the command
// is refused with an explicit error, because a silent no-op would look to the suite
// like a converged identity set.

import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import {
  GOLDEN_DB_BASE,
  assertDatabaseName,
  terminateBackendsStatement,
} from "./golden-db.mjs";

/** Raised for an unusable input or plan — the caller must fail closed. */
export class SlotError extends Error {
  constructor(message) {
    super(message);
    this.name = "SlotError";
  }
}

// --- constants ---------------------------------------------------------------

/** `main` (the merged head) or `pr-<N>` (a preview). Nothing else is a slot. */
export const SLOT_NAME_RE = /^(?:main|pr-[1-9][0-9]{0,9})$/;

/** A full commit id — the tag suffix is derived here, never supplied. */
export const FULL_SHA_RE = /^[0-9a-f]{40}$/;

/** GHCR namespace the preview workflow pushes to (spec §5 «Build»). */
export const GHCR_REPO = "ghcr.io/doctor-school/ds-platform";

/** The five images a slot runs. `api-migrate` is the `migrate` Dockerfile target. */
export const SLOT_IMAGE_APPS = Object.freeze([
  "api",
  "api-migrate",
  "portal",
  "doctor",
  "admin",
]);

/** RAM budget, not a preference: §3 «Box» sizes the box for `main` + 3 previews. */
export const PREVIEW_SLOT_CAP = 3;

/** Redis logical databases available to previews; `main` owns 0 (§3 «Slots»). */
export const REDIS_DB_MIN = 1;
export const REDIS_DB_MAX = 15;

/** The shared edge container `slot up` attaches to each slot network. */
export const CADDY_CONTAINER = "stg-infra-caddy-1";

/** The shared Postgres container the CLI reaches `psql` through. */
export const POSTGRES_CONTAINER = "stg-infra-postgres-1";

/** Registry of live slots — the single source both include files render from. */
export const REGISTRY_PATH = "/var/lib/ds-platform/slots.json";

/** Bind-mounted into the caddy container as `/etc/caddy/slots` (read-only). */
export const CADDY_INCLUDE_DIR = "/etc/ds-platform/caddy";
export const ASK_INCLUDE_PATH = `${CADDY_INCLUDE_DIR}/ask.caddy`;
export const SLOTS_INCLUDE_PATH = `${CADDY_INCLUDE_DIR}/slots.caddy`;

/** Per-slot, non-secret env files. The box secret set stays in ONE file. */
export const SLOT_ENV_DIR = "/etc/ds-platform/slots";
export const STAGE_ENV_FILE = "/etc/ds-platform/stage.env";

/** Where the install script lands the slot compose project on the box. */
export const SLOT_COMPOSE_FILE = "/opt/ds-platform/compose/slot/compose.yml";

/**
 * Append-only audit trail of the destructive operator commands.
 *
 * `reset main` throws away the accumulated staging data of the shared `main` slot.
 * That is a legitimate operator action, but it must never be deniable: one line per
 * run naming the human, the moment and the SHA the slot was re-converged on.
 */
export const SLOT_LOG_DIR = "/var/log/ds-platform";
export const SLOT_LOG_PATH = `${SLOT_LOG_DIR}/slot.log`;

/**
 * Free-disk floor for the unconditional prune.
 *
 * `tools/deploy/prod.mjs` caps BuildKit cache at `BUILD_CACHE_RESERVED_SPACE =
 * "10GB"`. That is a BUILD-cache knob and this box builds nothing, so the figure is
 * re-mapped rather than copied: same number, different mechanism — below this much
 * free space on the Docker root, `gc` additionally prunes dangling/unreferenced
 * images. The slot-tagged images of unregistered slots are removed regardless.
 */
export const GC_FREE_SPACE_FLOOR = "10GB";
export const GC_FREE_SPACE_FLOOR_BYTES = 10 * 1024 ** 3;
export const DOCKER_ROOT = "/var/lib/docker";

// --- name derivation ---------------------------------------------------------

export function assertSlotName(slot) {
  if (!SLOT_NAME_RE.test(String(slot ?? ""))) {
    throw new SlotError(
      `unusable slot name: ${JSON.stringify(slot)} — expected \`main\` or \`pr-<N>\``,
    );
  }
  return slot;
}

/** `pr-2034` → 2034; `main` → null. */
export function previewNumber(slot) {
  assertSlotName(slot);
  return slot === "main" ? null : Number(slot.slice(3));
}

/** Compose project name — also the slot's own network name (see below). */
export function composeProjectName(slot) {
  return `slot-${assertSlotName(slot)}`;
}

/**
 * The slot's own compose network.
 *
 * Named explicitly (not `<project>_default`) because `slot up` connects the shared
 * Caddy container to it by name from the host, and `slot down` disconnects it.
 */
export function slotNetworkName(slot) {
  return `slot-${assertSlotName(slot)}`;
}

/**
 * `main` → `ds_main`, `pr-2034` → `ds_pr_2034`.
 *
 * The dash cannot survive: the name reaches `CREATE DATABASE` as raw SQL text, and
 * `golden-db.mjs`'s guard (the one the template build already uses) rejects it.
 */
export function slotDatabaseName(slot) {
  assertSlotName(slot);
  return assertDatabaseName(`ds_${slot.replace(/-/g, "_")}`);
}

const DOMAIN_RE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function assertBaseDomain(baseDomain) {
  if (!DOMAIN_RE.test(String(baseDomain ?? ""))) {
    throw new SlotError(
      `unusable STAGE_BASE_DOMAIN: ${JSON.stringify(baseDomain)} — expected a hostname like stage.doctor.school`,
    );
  }
  return baseDomain;
}

/** The four public hostnames of a slot under the wildcard record (§3 «Hostnames»). */
export function slotHostnames(slot, baseDomain) {
  assertSlotName(slot);
  assertBaseDomain(baseDomain);
  return {
    academy: `academy-${slot}.${baseDomain}`,
    doctor: `doctor-${slot}.${baseDomain}`,
    admin: `admin-${slot}.${baseDomain}`,
    api: `api-${slot}.${baseDomain}`,
  };
}

/** The shared IdP origin — one host for every slot, never per-slot (§3 «Identity»). */
export function idpHostname(baseDomain) {
  assertBaseDomain(baseDomain);
  return `id.${baseDomain}`;
}

/**
 * The container names the Caddy `(slot)` snippet dials.
 *
 * `infra/deploy/compose/stg-infra/Caddyfile` reverse-proxies `{args[0]}-portal:3001`
 * and friends, so these names are a CONTRACT, not an implementation detail: the slot
 * compose sets them as `container_name`.
 */
export function containerAliases(slot) {
  assertSlotName(slot);
  return {
    api: `${slot}-api`,
    portal: `${slot}-portal`,
    doctor: `${slot}-doctor`,
    admin: `${slot}-admin`,
    centrifugo: `${slot}-centrifugo`,
  };
}

export function shortSha(sha) {
  if (!FULL_SHA_RE.test(String(sha ?? ""))) {
    throw new SlotError(
      `unusable commit id: ${JSON.stringify(sha)} — expected a full 40-character lowercase hex SHA`,
    );
  }
  return sha.slice(0, 7);
}

/** `ghcr.io/doctor-school/ds-platform/<app>:<slot>-<sha7>` for the five apps. */
export function slotImageRefs(slot, sha) {
  assertSlotName(slot);
  const tag = `${slot}-${shortSha(sha)}`;
  return Object.fromEntries(
    SLOT_IMAGE_APPS.map((app) => [app, `${GHCR_REPO}/${app}:${tag}`]),
  );
}

// --- Redis logical database allocation --------------------------------------

/**
 * One Redis logical database per slot, `main` = 0.
 *
 * Deterministic from the PR number so a re-converge of the same slot lands on the
 * same database and the previous one is not orphaned. A collision with ANOTHER live
 * slot is refused rather than shared: two slots on one database would cross OTP
 * challenges, session revocation and rate-limit keys, and the failure would look
 * like a product bug. The preview cap is 3 against 15 databases, so a refusal is a
 * rare, self-clearing state — the deployer converges again on its next 60-second
 * tick, once the colliding slot is down.
 */
export function allocateRedisDatabase(slot, registry) {
  assertSlotName(slot);
  if (slot === "main") return 0;
  const live = registry?.slots ?? {};
  if (live[slot]) return live[slot].redisDb;
  const span = REDIS_DB_MAX - REDIS_DB_MIN + 1;
  const taken = new Set(
    Object.entries(live)
      .filter(([name]) => name !== slot)
      .map(([, entry]) => entry.redisDb),
  );
  // Deterministic start, then a linear probe. `1 + (N % 15)` collides for PR
  // numbers 15 apart, and refusing outright would dead-end that converge for as
  // long as the holder is up; probing keeps allocation exclusive (never shared)
  // without making one live preview block another.
  const start = REDIS_DB_MIN + (previewNumber(slot) % span);
  for (let offset = 0; offset < span; offset += 1) {
    const candidate = REDIS_DB_MIN + ((start - REDIS_DB_MIN + offset) % span);
    if (!taken.has(candidate)) return candidate;
  }
  throw new SlotError(
    `no free Redis database in ${REDIS_DB_MIN}..${REDIS_DB_MAX} for ${slot}: ` +
      `${[...taken].sort((a, b) => a - b).join(", ")} are all held. ` +
      `Take a slot down (its PR is closed or draft) and converge again.`,
  );
}

/** The fourth preview is refused — the box is sized for `main` + 3 (§3 «Box»). */
export function assertPreviewCapacity(slot, registry) {
  assertSlotName(slot);
  if (slot === "main") return slot;
  const live = registry?.slots ?? {};
  if (live[slot]) return slot;
  const previews = Object.keys(live).filter((name) => name !== "main");
  if (previews.length >= PREVIEW_SLOT_CAP) {
    throw new SlotError(
      `preview cap reached (${PREVIEW_SLOT_CAP}): ${previews.join(", ")} are up, refusing ${slot}. ` +
        `The box is sized for main + ${PREVIEW_SLOT_CAP} idle slots (spec §3 «Box»).`,
    );
  }
  return slot;
}

// --- database clone ----------------------------------------------------------

/**
 * `CREATE DATABASE ds_pr_<N> TEMPLATE ds_golden`, from scratch every time.
 *
 * Postgres refuses to use a template while another session is connected to it, so
 * the template's backends are terminated first — a forgotten `psql` or a concurrent
 * clone would otherwise stall the converge indefinitely.
 *
 * `bootstrap: true` is the ONE case that is not a re-clone: the very first `up main`
 * on a fresh box, where `ds_main` does not exist yet. It emits no `DROP`, because
 * dropping `ds_main` is exactly what must never happen (§4: `main` is persistent and
 * forward-migrated).
 */
export function cloneDatabaseStatements(slot, { bootstrap = false } = {}) {
  assertSlotName(slot);
  if (slot === "main" && !bootstrap) {
    throw new SlotError(
      "refusing to clone `main`: its database is persistent and forward-migrated (spec §4). " +
        "Only the first bring-up on an empty box bootstraps it from the template.",
    );
  }
  const database = slotDatabaseName(slot);
  const template = GOLDEN_DB_BASE;
  const statements = [];
  if (!bootstrap) {
    statements.push(
      terminateBackendsStatement(database),
      `DROP DATABASE IF EXISTS "${database}"`,
    );
  }
  statements.push(
    terminateBackendsStatement(template),
    `CREATE DATABASE "${database}" TEMPLATE "${template}"`,
  );
  return statements;
}

/**
 * Teardown of a preview database. `main` is never dropped by a teardown.
 *
 * `allowMain: true` is the ONE caller that may: `slot reset main` (#2064 part 2a),
 * which drops `ds_main` only to re-clone it from `ds_golden` in the same plan. The
 * escape lives here rather than in a second, subtly different DROP builder, so the
 * guard and the statement order stay in one place — and so a future caller has to
 * ask for it by name instead of hand-rolling the SQL.
 */
export function dropDatabaseStatements(slot, { allowMain = false } = {}) {
  assertSlotName(slot);
  if (slot === "main" && !allowMain) {
    throw new SlotError(
      "refusing to drop `ds_main`: the main slot's database is persistent (spec §4).",
    );
  }
  const database = slotDatabaseName(slot);
  return [
    terminateBackendsStatement(database),
    `DROP DATABASE IF EXISTS "${database}"`,
  ];
}

/**
 * What a converge does to the slot's database.
 *
 * `clone`     — a preview: drop and re-clone from the template, every time.
 * `bootstrap` — the first `up main` on a box with no `ds_main` yet.
 * `reuse`     — `main` afterwards: forward-migrated in place, never re-created.
 */
export function databaseAction({ slot, action, exists }) {
  assertSlotName(slot);
  if (slot !== "main") return "clone";
  if (action === "up" && exists === false) return "bootstrap";
  return "reuse";
}

// --- command plans -----------------------------------------------------------

/**
 * The compose invocation for a slot.
 *
 * Both env files are passed with `--env-file` so compose INTERPOLATION sees them:
 * the box secret set (`stage.env` — `POSTGRES_PASSWORD`, the Centrifugo pair, the
 * captcha key) and the slot's own non-secret file. That is what lets the slot
 * compose build `DATABASE_URL` from `${POSTGRES_PASSWORD}` + `${SLOT_DB}` without a
 * second on-box copy of the password.
 */
export function composeBase(slot) {
  return [
    "docker",
    "compose",
    "--env-file",
    STAGE_ENV_FILE,
    "--env-file",
    slotEnvPath(slot),
    "-p",
    composeProjectName(slot),
    "-f",
    SLOT_COMPOSE_FILE,
  ];
}

export function pullCommandPlan(slot) {
  return { kind: "sh", label: "pull images", command: [...composeBase(slot), "pull"] };
}

export function upCommandPlan(slot) {
  return {
    kind: "sh",
    label: "up -d",
    command: [...composeBase(slot), "up", "-d", "--remove-orphans"],
  };
}

/**
 * `docker compose down` for a slot.
 *
 * `-v` for a preview (its anonymous/named volumes are as disposable as its
 * database); NOT for `main`, whose volumes back the persistent slot.
 */
export function downCommandPlan(slot) {
  const command = [...composeBase(slot), "down", "--remove-orphans"];
  if (slot !== "main") command.push("-v");
  return { kind: "sh", label: "compose down", command };
}

/** Migrations run in the slot's OWN `migrate` image — never on the host (§3). */
export function migrateCommandPlan(slot) {
  return {
    kind: "sh",
    label: "migrate",
    command: [
      ...composeBase(slot),
      "--profile",
      "migrate",
      "run",
      "--rm",
      "migrate",
      "pnpm",
      "run",
      "drizzle:migrate:ci",
    ],
  };
}

/**
 * The BRANCH's golden seed, in the branch's own image.
 *
 * A clone of `ds_golden` is already seeded with the template's generation. This step
 * exists for the drift case (§9 «Golden seed drift»): a PR that extends the golden
 * set must see its own rows before the template is rebuilt on the next `main`
 * deploy. The seed is an idempotent upsert (§4), so running it on a fresh clone
 * changes nothing.
 */
export function seedCommandPlan(slot) {
  return {
    kind: "sh",
    label: "seed:golden",
    command: [
      ...composeBase(slot),
      "--profile",
      "migrate",
      "run",
      "--rm",
      "migrate",
      "pnpm",
      "--filter",
      "@ds/db",
      "run",
      "seed:golden",
    ],
  };
}

/**
 * Is Caddy on this network already? Reads `docker network inspect --format
 * '{{json .Containers}}'`, a map of container id → `{ Name, … }`.
 *
 * The membership question cannot be answered by an exit status: `network inspect`
 * exits 0 for a network that exists whether or not Caddy is on it. So the probe is
 * read for CONTENT, and output that is not the documented shape throws rather than
 * being guessed as «absent» — a wrong «absent» issues a `connect` that then fails.
 */
export function caddyIsAttached(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text || text === "null") return false;
  let containers;
  try {
    containers = JSON.parse(text);
  } catch {
    throw new SlotError(
      `could not read \`docker network inspect --format '{{json .Containers}}'\`: ` +
        `expected a JSON object, got ${text.slice(0, 120)}`,
    );
  }
  if (containers === null) return false;
  if (typeof containers !== "object" || Array.isArray(containers)) {
    throw new SlotError(
      `could not read \`docker network inspect --format '{{json .Containers}}'\`: ` +
        `expected a JSON object, got ${text.slice(0, 120)}`,
    );
  }
  return Object.values(containers).some((entry) => entry?.Name === CADDY_CONTAINER);
}

function caddyAttachmentProbe(slot) {
  return [
    "docker",
    "network",
    "inspect",
    slotNetworkName(slot),
    "--format",
    "{{json .Containers}}",
  ];
}

/**
 * Caddy joins the slot's network so it resolves `<slot>-portal` and friends.
 *
 * `ensure-present`, the twin of `ensure-absent` below, because neither `docker network
 * connect` nor `disconnect` is idempotent: a re-converge (`sync`, or a second `up` —
 * neither ever tears the network down) finds Caddy already attached and `connect`
 * exits 1 with «endpoint … already exists». Probing first makes the expected no-op a
 * SUCCESS with nothing to do, which leaves the failure of a connect that actually ran
 * meaning exactly one thing: the slot's hostnames resolve to nothing. That is a hard
 * failure, and it aborts the plan BEFORE the registry write, so a converge that could
 * not attach Caddy never registers a hostname it cannot serve.
 */
export function caddyAttachCommand(slot) {
  return {
    kind: "ensure-present",
    label: "attach caddy",
    items: [
      {
        probe: caddyAttachmentProbe(slot),
        match: caddyIsAttached,
        apply: [
          "docker",
          "network",
          "connect",
          slotNetworkName(slot),
          CADDY_CONTAINER,
        ],
      },
    ],
  };
}

/**
 * The slot network, made ABSENT after `compose down`.
 *
 * Compose owns `slot-<slot>` (`infra/deploy/compose/slot/compose.yml`) and removes it
 * on a healthy `compose down` — but only if nothing is still attached. So a network
 * that outlives `compose down` means something is still on it, and the §8 step-4
 * acceptance («no container, volume, database or image») is quietly missed.
 *
 * Hence `ensure-absent` rather than an `rm` whose failure is shrugged off: the
 * executor probes first, so «compose already took it» is a SUCCESS with nothing to
 * do, while «it is still there and cannot be removed» is a hard failure.
 */
export function slotNetworkRemoveCommand(slot) {
  const network = slotNetworkName(slot);
  return {
    kind: "ensure-absent",
    label: "remove slot network",
    items: [
      {
        probe: ["docker", "network", "inspect", network],
        remove: ["docker", "network", "rm", network],
      },
    ],
  };
}

/**
 * The same membership fact as `caddyAttachCommand`, driven to the other end.
 *
 * A `down` after a partial `up` finds Caddy never attached, and `docker network
 * disconnect` exits 1 with «is not connected to network». Probed, that is the desired
 * end state and nothing runs; a disconnect that does run and fails leaves the network
 * un-removable a few steps later, so it stops the teardown instead of being logged.
 */
export function caddyDetachCommand(slot) {
  return {
    kind: "ensure-absent",
    label: "detach caddy",
    items: [
      {
        probe: caddyAttachmentProbe(slot),
        match: caddyIsAttached,
        remove: [
          "docker",
          "network",
          "disconnect",
          slotNetworkName(slot),
          CADDY_CONTAINER,
        ],
      },
    ],
  };
}

/** A config reload through the admin API — never a restart (certificates in RAM). */
export function caddyReloadCommand() {
  return {
    kind: "sh",
    label: "reload caddy",
    command: [
      "docker",
      "exec",
      CADDY_CONTAINER,
      "caddy",
      "reload",
      "--config",
      "/etc/caddy/Caddyfile",
    ],
  };
}

// --- the registry ------------------------------------------------------------

export function emptyRegistry() {
  return { slots: {} };
}

export function parseRegistry(text) {
  if (text === null || text === undefined || String(text).trim() === "") {
    return emptyRegistry();
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SlotError(
      `${REGISTRY_PATH} is not valid JSON — refusing to render Caddy includes from it`,
    );
  }
  const slots = parsed?.slots;
  if (!slots || typeof slots !== "object" || Array.isArray(slots)) {
    throw new SlotError(`${REGISTRY_PATH} has no \`slots\` object`);
  }
  for (const name of Object.keys(slots)) assertSlotName(name);
  return { slots: { ...slots } };
}

export function serializeRegistry(registry) {
  return `${JSON.stringify(registry, null, 2)}\n`;
}

export function registerSlot(registry, { slot, sha, redisDb, hosts, updatedAt }) {
  assertSlotName(slot);
  shortSha(sha);
  return {
    slots: {
      ...(registry?.slots ?? {}),
      [slot]: { sha, redisDb, hosts: [...hosts], updatedAt },
    },
  };
}

export function deregisterSlot(registry, slot) {
  assertSlotName(slot);
  const slots = { ...(registry?.slots ?? {}) };
  delete slots[slot];
  return { slots };
}

const GENERATED_HEADER =
  "# generated by tools/staging/slot.mjs from /var/lib/ds-platform/slots.json — do not edit by hand";

/**
 * The `ask` endpoint's matcher: 200 only for hosts a live slot serves.
 *
 * This is what bounds ACME. Every name under `*.stage.doctor.school` resolves, so
 * without it a typo or a crawler starts a doomed certificate order on Caddy's
 * on-demand path. `id.<base>` is registered unconditionally — it is the shared IdP
 * origin, not a slot, and it must hold a certificate whether or not any slot is up.
 */
export function renderAskInclude(registry, { baseDomain }) {
  const hosts = [
    idpHostname(baseDomain),
    ...Object.keys(registry?.slots ?? {})
      .sort()
      .flatMap((slot) => registry.slots[slot].hosts),
  ];
  const matcher = hosts.map((host) => `domain=${host}`).join(" ");
  return [
    GENERATED_HEADER,
    "# On-demand TLS gate (spec §3 «Hostnames»): 200 = this host belongs to a live slot.",
    `@registered query ${matcher}`,
    "respond @registered 200",
    "",
  ].join("\n");
}

/** One `import slot <name>` per live slot — the vhosts of the `(slot)` snippet. */
export function renderSlotsInclude(registry) {
  const slots = Object.keys(registry?.slots ?? {}).sort();
  const lines = [
    GENERATED_HEADER,
    "# One `import` line per live slot; the `(slot)` snippet lives in the Caddyfile.",
  ];
  if (slots.length === 0) {
    lines.push("# (no slot is up)");
  } else {
    lines.push(...slots.map((slot) => `import slot ${slot}`));
  }
  lines.push("");
  return lines.join("\n");
}

// --- the per-slot env file ---------------------------------------------------

export function slotEnvPath(slot) {
  return `${SLOT_ENV_DIR}/${assertSlotName(slot)}.env`;
}

/**
 * The slot's own, NON-SECRET env file.
 *
 * Deliberately no `DATABASE_URL`: it would carry `POSTGRES_PASSWORD` into a second
 * on-box file. The slot compose builds it from `${POSTGRES_PASSWORD}` (interpolated
 * from `stage.env`) and `${SLOT_DB}` from here, so the password lives in exactly one
 * place. Everything else a slot needs that is not slot-specific — the Centrifugo
 * pair, the captcha key, the sink endpoints — comes from `stage.env` directly.
 *
 * Variable names are the api's own (`apps/api/src/config/env.schema.ts`); none is
 * invented here.
 */
export function renderSlotEnv({ slot, sha, baseDomain, redisDb }) {
  assertSlotName(slot);
  const hosts = slotHostnames(slot, baseDomain);
  return [
    `# generated by tools/staging/slot.mjs for slot ${slot} — do not edit by hand`,
    "# Non-secret only: the box secret set stays in /etc/ds-platform/stage.env.",
    `SLOT=${slot}`,
    `SLOT_SHA7=${shortSha(sha)}`,
    `SLOT_DB=${slotDatabaseName(slot)}`,
    `DEPLOY_SHA=${sha}`,
    `REDIS_URL=redis://redis:6379/${redisDb}`,
    "API_PROXY_TARGET=http://api:3000",
    `CENTRIFUGO_URL=https://${hosts.api}`,
    `IDP_ISSUER=https://${idpHostname(baseDomain)}`,
    `IDP_REDIRECT_URI=https://${hosts.api}/auth/callback`,
    `MAILER_PORTAL_BASE_URL=https://${hosts.academy}`,
    // Sink partitioning is by sender local part, not by a Mailpit per slot
    // (spec §3 «Sink partitioning across slots»).
    `MAILER_SMTP_FROM=no-reply+${slot}@${baseDomain}`,
    "",
  ].join("\n");
}

/**
 * The env file `down` writes before it calls compose.
 *
 * `composeBase` passes `--env-file <slot>.env`, and compose ABORTS when that file is
 * absent — so a `down` after a half-failed `up`, or after someone removed the file by
 * hand, could not tear anything down and left the containers, the network, the
 * volumes and the database behind. Re-rendering it first makes teardown total.
 *
 * With a registry entry the file is byte-identical to the one `up` wrote. Without one
 * (the slot is gone from the registry but its containers are not) only the two
 * variables compose needs to ADDRESS the project are known: the project name comes
 * from `-p`, and image tags are never resolved by `down`, which matches containers by
 * project label — hence the placeholder `SLOT_SHA7`.
 */
export function renderSlotDownEnv({ slot, entry, baseDomain }) {
  assertSlotName(slot);
  if (entry?.sha && Number.isInteger(entry.redisDb)) {
    return renderSlotEnv({ slot, sha: entry.sha, baseDomain, redisDb: entry.redisDb });
  }
  return [
    `# generated by tools/staging/slot.mjs to tear slot ${slot} down — do not edit by hand`,
    "# The slot is not in the registry; only what compose needs to ADDRESS the project",
    "# is known. `down` matches containers by project label, never by image tag.",
    `SLOT=${slot}`,
    `SLOT_SHA7=0000000`,
    `SLOT_DB=${slotDatabaseName(slot)}`,
    "",
  ].join("\n");
}

// --- the shared IdP's redirect-URI set ---------------------------------------

/**
 * Every redirect URI the shared Zitadel app must hold, for the whole registry.
 *
 * §3 «Identity» gives the stand ONE Zitadel instance, one project, one client, so a
 * slot's callback works only if it is registered on that shared app — and the
 * registration write (`provision.sh`, `IDP_REDIRECT_URIS` / `IDP_POST_LOGOUT_URIS`) is
 * whole-set: a partial list silently drops the others. This seam is that whole set,
 * derived from the one registry, so the converge can never register one slot by
 * blanking another.
 *
 * PART 1 ONLY COMPUTES IT. `slot status` prints it; nothing here writes to the IdP.
 * Part 2 owns the converge that PUTs this set onto the shared app through the same
 * management API and PAT path `provision.sh` uses.
 *
 * The redirect path is the one `renderSlotEnv` hands the api in `IDP_REDIRECT_URI` —
 * a test pins the two together. The post-logout set is the browser origins of each
 * slot (the api BFF is a callback target, never a logout landing); it exists because
 * the write is whole-set, so part 2 must send it alongside the redirect list rather
 * than blank what provision.sh registered.
 */
export function renderIdpRedirectUris(registry, baseDomain) {
  assertBaseDomain(baseDomain);
  const slots = Object.keys(registry?.slots ?? {}).sort();
  const redirectUris = [];
  const postLogoutUris = [];
  for (const slot of slots) {
    const hosts = slotHostnames(slot, baseDomain);
    redirectUris.push(`https://${hosts.api}/auth/callback`);
    postLogoutUris.push(
      `https://${hosts.academy}`,
      `https://${hosts.doctor}`,
      `https://${hosts.admin}`,
    );
  }
  return {
    redirectUris: [...new Set(redirectUris)],
    postLogoutUris: [...new Set(postLogoutUris)],
  };
}

// --- gc ----------------------------------------------------------------------

const IMAGE_TAG_RE = /^(main|pr-[1-9][0-9]{0,9})-[0-9a-f]{7}$/;

/** `pr-2034-0123456` → `pr-2034`; anything that is not a slot tag → `null`. */
export function slotOfImageTag(tag) {
  const match = IMAGE_TAG_RE.exec(String(tag ?? ""));
  return match ? match[1] : null;
}

/**
 * Images of slots that are not in the registry.
 *
 * The registry — not the PR list and not a timestamp — is the authority: an image
 * whose slot is live is in use, everything else slot-tagged is garbage. Non-slot
 * images (the shared infra: caddy, postgres, zitadel…) are never touched, so a gc
 * run can never take the stand down.
 */
export function planImageGc({ images, registry }) {
  const live = new Set(Object.keys(registry?.slots ?? {}));
  const remove = (images ?? []).filter((ref) => {
    const tag = String(ref).split(":").pop();
    const slot = slotOfImageTag(tag);
    return slot !== null && !live.has(slot);
  });
  // Same shape as the teardown's image removal: an image a previous `gc` or `down`
  // already took is the desired end state, while one that is there and refuses to go
  // (still referenced by a stopped container) is an operator's problem, not a shrug.
  const commands = remove.length
    ? [
        {
          kind: "ensure-absent",
          label: "remove unreferenced slot images",
          items: remove.map((ref) => ({
            probe: ["docker", "image", "inspect", ref],
            remove: ["docker", "image", "rm", ref],
          })),
        },
      ]
    : [];
  return { remove, commands };
}

/**
 * The second, CONDITIONAL half of gc — see `GC_FREE_SPACE_FLOOR`.
 *
 * Never `buildx prune`: the box has no build cache to reclaim, and calling it would
 * be a copied gesture rather than a lever (§9 «Disk pressure» says the same about
 * the `builder.gc` block in `cloud-init/stage-1.yaml`).
 */
export function planPruneByFreeSpace({ freeBytes }) {
  if (freeBytes >= GC_FREE_SPACE_FLOOR_BYTES) return { commands: [] };
  return {
    commands: [
      {
        // `image prune` is idempotent by itself: nothing to reclaim exits 0. So a
        // failure here is a real docker failure, and it fails `gc`.
        kind: "sh",
        label: `free disk below ${GC_FREE_SPACE_FLOOR} — pruning unreferenced images`,
        command: ["docker", "image", "prune", "-af", "--filter", "until=24h"],
      },
    ],
  };
}

// --- the ordered plans -------------------------------------------------------

function renderIncludeSteps(registry, baseDomain) {
  return {
    kind: "write-many",
    label: "render caddy includes",
    files: [
      { path: ASK_INCLUDE_PATH, contents: renderAskInclude(registry, { baseDomain }), mode: 0o644 },
      { path: SLOTS_INCLUDE_PATH, contents: renderSlotsInclude(registry), mode: 0o644 },
    ],
  };
}

/**
 * `up` / `sync` — the converge, in the only order that is safe.
 *
 * Registration comes AFTER `up -d`: a host registered before its upstream exists
 * gets a certificate issued for something that answers 502, and burns a Let's
 * Encrypt order doing it. Teardown mirrors it (see `planSlotDown`).
 */
export function planSlotUp({
  slot,
  sha,
  registry,
  baseDomain,
  action = "up",
  databaseExists,
  now = new Date(),
}) {
  assertSlotName(slot);
  shortSha(sha);
  assertBaseDomain(baseDomain);
  if (action !== "up" && action !== "sync") {
    throw new SlotError(`unknown converge action: ${JSON.stringify(action)}`);
  }
  assertPreviewCapacity(slot, registry);
  const redisDb = allocateRedisDatabase(slot, registry);
  const hosts = Object.values(slotHostnames(slot, baseDomain));
  const nextRegistry = registerSlot(registry, {
    slot,
    sha,
    redisDb,
    hosts,
    updatedAt: now.toISOString(),
  });

  const steps = [
    {
      kind: "write",
      label: "write slot env",
      path: slotEnvPath(slot),
      contents: renderSlotEnv({ slot, sha, baseDomain, redisDb }),
      mode: 0o640,
    },
  ];

  const dbAction = databaseAction({ slot, action, exists: databaseExists });
  if (dbAction !== "reuse") {
    steps.push({
      kind: "sql",
      label: "clone database",
      statements: cloneDatabaseStatements(slot, {
        bootstrap: dbAction === "bootstrap",
      }),
    });
  }

  steps.push(
    pullCommandPlan(slot),
    migrateCommandPlan(slot),
    seedCommandPlan(slot),
    upCommandPlan(slot),
    caddyAttachCommand(slot),
    {
      kind: "write",
      label: "write registry",
      path: REGISTRY_PATH,
      contents: serializeRegistry(nextRegistry),
      mode: 0o644,
    },
    renderIncludeSteps(nextRegistry, baseDomain),
    caddyReloadCommand(),
  );

  return { slot, sha, redisDb, hosts, registry: nextRegistry, steps };
}

/**
 * `down` — deregister FIRST, tear down after.
 *
 * The reverse order would leave hostnames certifiable and imported while nothing
 * serves them: Caddy would answer 502 behind a valid certificate instead of the
 * honest «no slot owns this host» 404, and on-demand issuance would keep trying.
 */
export function planSlotDown({ slot, registry, baseDomain, now = new Date() }) {
  assertSlotName(slot);
  assertBaseDomain(baseDomain);
  void now;
  const entry = registry?.slots?.[slot];
  const nextRegistry = deregisterSlot(registry, slot);

  const steps = [
    {
      kind: "write",
      label: "ensure slot env",
      path: slotEnvPath(slot),
      contents: renderSlotDownEnv({ slot, entry, baseDomain }),
      mode: 0o640,
    },
    caddyDetachCommand(slot),
    {
      kind: "write",
      label: "write registry",
      path: REGISTRY_PATH,
      contents: serializeRegistry(nextRegistry),
      mode: 0o644,
    },
    renderIncludeSteps(nextRegistry, baseDomain),
    caddyReloadCommand(),
    downCommandPlan(slot),
    slotNetworkRemoveCommand(slot),
  ];

  if (slot !== "main") {
    steps.push({
      kind: "sql",
      label: "drop database",
      statements: dropDatabaseStatements(slot),
    });
    if (entry?.sha) {
      // Same reasoning as the network: an image a previous teardown (or `gc`) already
      // removed is the desired end state, not a failure — but an image that is there
      // and refuses to go is one.
      steps.push({
        kind: "ensure-absent",
        label: "remove slot images",
        items: Object.values(slotImageRefs(slot, entry.sha)).map((ref) => ({
          probe: ["docker", "image", "inspect", ref],
          remove: ["docker", "image", "rm", ref],
        })),
      });
    }
    steps.push({
      // `rm -f` is already idempotent; nothing to probe.
      kind: "sh",
      label: "remove slot env",
      command: ["rm", "-f", slotEnvPath(slot)],
    });
  }

  return { slot, registry: nextRegistry, steps };
}

// --- reset -------------------------------------------------------------------

/** The one audit line a `reset main` appends. Pure, so its shape is testable. */
export function resetLogLine({ actor, sha, now = new Date() }) {
  return `${now.toISOString()} reset main by ${actor || "unknown"} sha=${sha}\n`;
}

/**
 * `reset main` — throw `ds_main` away and re-clone it from `ds_golden`.
 *
 * Only `main` is resettable, and that is not an arbitrary restriction: a preview's
 * database is re-cloned from the template on every single converge (§4), so `sync
 * pr-<N>` already IS its reset. `main` is the one slot whose database is persistent
 * and forward-migrated, so it is the one slot that can drift far enough from the
 * template to need a deliberate, audited wipe.
 *
 * Order: audit line FIRST, then the drop/clone, then the ordinary `up` steps on the
 * SHA the registry currently holds. The audit line is written before anything is
 * destroyed on purpose — a line that only lands when the wipe succeeds cannot answer
 * «who ran the thing that broke the box halfway through».
 *
 * `ds_golden` is read as a template and never written: the drop names `ds_main` and
 * nothing else, and the clone is `cloneDatabaseStatements(… { bootstrap: true })`,
 * whose only `DROP` is the one suppressed by `bootstrap`.
 */
export function planSlotReset({
  registry,
  baseDomain,
  actor,
  now = new Date(),
}) {
  assertBaseDomain(baseDomain);
  const entry = registry?.slots?.main;
  if (!entry?.sha) {
    throw new SlotError(
      "refusing to reset `main`: it is not in the registry, so there is no SHA to " +
        "re-converge on. Bring it up first with `slot up main <sha>`.",
    );
  }
  const sha = entry.sha;
  shortSha(sha);
  // `databaseExists: true` — the drop/clone below re-creates it in the same plan, so
  // the converge that follows must NOT emit a second clone.
  const up = planSlotUp({
    slot: "main",
    sha,
    registry,
    baseDomain,
    action: "up",
    databaseExists: true,
    now,
  });
  const steps = [
    {
      kind: "append",
      label: "audit the reset",
      path: SLOT_LOG_PATH,
      contents: resetLogLine({ actor, sha, now }),
      mode: 0o640,
    },
    {
      kind: "sql",
      label: "re-clone the main database from the template",
      statements: [
        ...dropDatabaseStatements("main", { allowMain: true }),
        ...cloneDatabaseStatements("main", { bootstrap: true }),
      ],
    },
    ...up.steps,
  ];
  return { slot: "main", sha, redisDb: up.redisDb, hosts: up.hosts, registry: up.registry, steps };
}

// --- the executor ------------------------------------------------------------

/**
 * Runs a plan through injected effects.
 *
 * `sql`, `sh`, `probe` and `write` are supplied by `main()` and replaced wholesale in
 * the tests, which is what keeps every plan above unit-testable without Postgres,
 * Docker or a filesystem.
 *
 * EVERY failure aborts the run — there is no tolerated failure and no step that is
 * allowed to fail. A step whose expected no-op looks like an error to docker is
 * expressed as a membership fact instead:
 *
 * - `ensure-absent` — «this must not exist afterwards». Each item is PROBED first and
 *   the removal runs only when the probe finds the resource.
 * - `ensure-present` — «this must exist afterwards», the exact twin: the apply runs
 *   only when the probe does NOT find it.
 *
 * Absent/present therefore means success with nothing to do, which is what lets a
 * re-converge (`sync`) and a teardown of a half-converged slot both exit 0, while a
 * command that actually ran and failed still aborts the plan.
 *
 * `probe` reports the exit status instead of throwing (`{ ok, stdout, stderr }`). An
 * item may add `match(stdout)` when the exit status alone cannot answer the question
 * — `docker network inspect` exits 0 for a network whether or not Caddy is on it. A
 * `match` item therefore REQUIRES the `probe` effect. Without one the executor falls
 * back to `sh` and reads a throw as «absent», which is what the offline plan tests
 * exercise for the plain `docker … inspect` items.
 */
export async function runSlotPlan(
  plan,
  { sql, sh, write, append, probe, log = () => {} },
) {
  const present = async (item, step) => {
    if (probe) {
      const result = await probe(item.probe, step);
      if (!result?.ok) return false;
      return item.match ? Boolean(item.match(result.stdout ?? "")) : true;
    }
    if (item.match) {
      throw new SlotError(
        `step "${step.label}" reads its probe's OUTPUT and so needs a \`probe\` effect; ` +
          "only the exit status is available through `sh`",
      );
    }
    try {
      await sh(item.probe, step);
      return true;
    } catch {
      return false;
    }
  };

  for (const step of plan.steps) {
    log(`[${step.label}]`);
    if (step.kind === "sql") {
      for (const statement of step.statements) await sql(statement, step);
    } else if (step.kind === "sh") await sh(step.command, step);
    else if (step.kind === "ensure-absent") {
      for (const item of step.items) {
        if (!(await present(item, step))) {
          log("  ↳ already absent");
          continue;
        }
        await sh(item.remove, step);
      }
    } else if (step.kind === "ensure-present") {
      for (const item of step.items) {
        if (await present(item, step)) {
          log("  ↳ already present");
          continue;
        }
        await sh(item.apply, step);
      }
    } else if (step.kind === "write") await write(step.path, step.contents, step.mode);
    else if (step.kind === "append") {
      if (!append) {
        throw new SlotError(
          `step "${step.label}" appends to ${step.path} and so needs an \`append\` ` +
            "effect; `write` would truncate the audit trail it is adding to",
        );
      }
      await append(step.path, step.contents, step.mode);
    } else if (step.kind === "write-many") {
      for (const file of step.files) await write(file.path, file.contents, file.mode);
    } else throw new SlotError(`unknown step kind: ${step.kind}`);
  }
  return plan;
}

/**
 * The converge/teardown half of the CLI, lifted out of `main()` so the branches
 * themselves are testable with injected effects — the round-3 regression («`sync` of
 * a converged slot exits non-zero») lived here, invisible to every plan-level test.
 *
 * Returns the line `main()` prints; failure is a throw, exactly as inside a plan.
 */
export async function runSlotCommand({
  options,
  registry,
  baseDomain,
  effects,
  databaseExists: mainDatabaseExists,
}) {
  if (options.command === "down") {
    const plan = planSlotDown({ slot: options.slot, registry, baseDomain });
    await runSlotPlan(plan, effects);
    return `slot ${options.slot} is down`;
  }
  if (options.command === "reset") {
    const plan = planSlotReset({ registry, baseDomain, actor: options.actor });
    await runSlotPlan(plan, effects);
    return (
      `slot main was reset from ${GOLDEN_DB_BASE} and re-converged on ` +
      `${shortSha(plan.sha)}: ${plan.hosts.join(", ")}`
    );
  }
  // Lazily: `databaseExists` may be a thunk, and it is asked ONLY here — inside the
  // `up`/`sync` branch, and only for `main`. `slot down main` used to pay a `docker
  // exec … psql` round trip to answer a question its plan never asks, which made a
  // teardown depend on a healthy Postgres for no reason (Mode (a) NIT, PR #2168).
  const databaseExists =
    options.slot === "main" && typeof mainDatabaseExists === "function"
      ? mainDatabaseExists()
      : mainDatabaseExists;
  const plan = planSlotUp({
    slot: options.slot,
    sha: options.sha,
    registry,
    baseDomain,
    action: options.command,
    databaseExists,
  });
  await runSlotPlan(plan, effects);
  return (
    `slot ${plan.slot} converged on ${shortSha(plan.sha)} ` +
    `(redis db ${plan.redisDb}): ${plan.hosts.join(", ")}`
  );
}

// --- CLI ---------------------------------------------------------------------

const COMMANDS_WITH_SLOT_AND_SHA = new Set(["up", "sync"]);
const COMMANDS_WITH_SLOT = new Set(["down"]);
const COMMANDS_WITHOUT_ARGS = new Set(["status", "gc", "render"]);
/** Part 2b of #2064 implements these; refusing beats a silent no-op. */
const DEFERRED_COMMANDS = new Set(["reset-identities"]);

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command) {
    throw new SlotError(
      "usage: slot up|sync <slot> <sha> | down <slot> | reset main --yes | status | gc | render",
    );
  }
  if (DEFERRED_COMMANDS.has(command)) {
    throw new SlotError(
      `\`${command}\` is not implemented until part 2b of #2064 — refusing rather than doing nothing. ` +
        "Until then, re-register a slot's redirect URIs by hand through " +
        "`infra/dev-stand/idp/provision.sh` with the WHOLE set `slot status` prints.",
    );
  }
  if (command === "reset") {
    // `reset` is the one destructive operator command, so both of its guards are
    // parse-time and neither is defaultable: the slot must be spelled `main` (a
    // preview is re-cloned by its every converge — `sync` already is its reset), and
    // `--yes` must be typed. A confirmation prompt would be worse than useless here:
    // the command is meant to be run over ssh in a non-interactive shell.
    const [slot, ...flags] = rest;
    if (!slot) throw new SlotError("`reset` requires <slot> (only `main` is resettable)");
    assertSlotName(slot);
    if (slot !== "main") {
      throw new SlotError(
        `refusing to reset \`${slot}\`: only \`main\` is resettable. A preview's database ` +
          "is re-cloned from `ds_golden` on every converge, so `slot sync " +
          `${slot} <sha>\` already is its reset.`,
      );
    }
    const unknown = flags.filter((flag) => flag !== "--yes");
    if (unknown.length) throw new SlotError(`unknown option: ${unknown[0]}`);
    if (!flags.includes("--yes")) {
      throw new SlotError(
        "refusing to reset `main` without `--yes`: this DROPS `ds_main` and re-clones it " +
          "from `ds_golden`, discarding everything staging has accumulated there.",
      );
    }
    return { command, slot, sha: undefined, yes: true };
  }
  if (COMMANDS_WITH_SLOT_AND_SHA.has(command)) {
    const [slot, sha] = rest;
    if (!slot || !sha) {
      throw new SlotError(`\`${command}\` requires <slot> and a full commit SHA`);
    }
    assertSlotName(slot);
    shortSha(sha);
    return { command, slot, sha };
  }
  if (COMMANDS_WITH_SLOT.has(command)) {
    const [slot] = rest;
    if (!slot) throw new SlotError(`\`${command}\` requires <slot>`);
    assertSlotName(slot);
    return { command, slot, sha: undefined };
  }
  if (COMMANDS_WITHOUT_ARGS.has(command)) {
    if (rest.length) throw new SlotError(`\`${command}\` takes no arguments`);
    return { command, slot: undefined, sha: undefined };
  }
  throw new SlotError(`unknown command: ${command}`);
}

/**
 * The registry as it is on disk, or an empty one on a box that has none yet.
 *
 * Exported because `deployer.mjs` reads the SAME file through the SAME parser: a
 * second reader with its own «file missing» convention is how two views of «which
 * slots are live» drift apart.
 */
export function readRegistry() {
  try {
    return parseRegistry(readFileSync(REGISTRY_PATH, "utf8"));
  } catch (err) {
    if (err?.code === "ENOENT") return emptyRegistry();
    throw err;
  }
}

function realEffects() {
  return {
    sql: (statement) =>
      execFileSync(
        "docker",
        [
          "exec",
          "-i",
          POSTGRES_CONTAINER,
          "psql",
          "-U",
          "ds",
          "-d",
          "postgres",
          "-v",
          "ON_ERROR_STOP=1",
          "-c",
          statement,
        ],
        { stdio: "inherit" },
      ),
    sh: (command) =>
      execFileSync(command[0], command.slice(1), { stdio: "inherit" }),
    // The probe REPORTS the exit status instead of throwing on it — «not found» is an
    // answer, not an error. Its output is captured so a `docker inspect` of a missing
    // resource does not spill a scary stderr line into an otherwise clean teardown.
    probe: (command) => {
      const result = spawnSync(command[0], command.slice(1), { encoding: "utf8" });
      if (result.error) throw result.error;
      return {
        ok: result.status === 0,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      };
    },
    write: (path, contents, mode) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, contents, { mode });
    },
    // Separate from `write` because it must NOT truncate: the audit trail of
    // `reset main` is the whole point of the file it appends to.
    append: (path, contents, mode) => {
      mkdirSync(dirname(path), { recursive: true, mode: 0o750 });
      appendFileSync(path, contents, { mode });
    },
    log: (line) => console.log(line),
  };
}

function requiredBaseDomain() {
  const baseDomain = process.env.STAGE_BASE_DOMAIN;
  if (!baseDomain) {
    throw new SlotError(
      "STAGE_BASE_DOMAIN is required — source /etc/ds-platform/stage.env before running this tool",
    );
  }
  return assertBaseDomain(baseDomain);
}

function databaseExists(name) {
  const out = execFileSync(
    "docker",
    [
      "exec",
      "-i",
      POSTGRES_CONTAINER,
      "psql",
      "-U",
      "ds",
      "-d",
      "postgres",
      "-tAc",
      `SELECT 1 FROM pg_database WHERE datname = '${assertDatabaseName(name)}'`,
    ],
    { encoding: "utf8" },
  );
  return out.trim() === "1";
}

function listImages() {
  const out = execFileSync(
    "docker",
    ["image", "ls", "--format", "{{.Repository}}:{{.Tag}}"],
    { encoding: "utf8" },
  );
  return out.split(/\r?\n/).filter(Boolean);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const registry = readRegistry();
  const effects = realEffects();

  if (options.command === "status") {
    console.log("# registry (/var/lib/ds-platform/slots.json)");
    console.log(serializeRegistry(registry).trimEnd());
    console.log("# shared IdP redirect set — part 2 converges this onto the app");
    if (process.env.STAGE_BASE_DOMAIN) {
      console.log(
        JSON.stringify(
          renderIdpRedirectUris(registry, requiredBaseDomain()),
          null,
          2,
        ),
      );
    } else {
      console.log("# (set STAGE_BASE_DOMAIN to render it)");
    }
    return;
  }

  if (options.command === "render") {
    const baseDomain = requiredBaseDomain();
    await runSlotPlan({ steps: [renderIncludeSteps(registry, baseDomain)] }, effects);
    console.log(`rendered ${ASK_INCLUDE_PATH} and ${SLOTS_INCLUDE_PATH}`);
    return;
  }

  if (options.command === "gc") {
    const images = planImageGc({ images: listImages(), registry });
    const { bsize, bavail } = statfsSync(DOCKER_ROOT);
    const prune = planPruneByFreeSpace({ freeBytes: bsize * bavail });
    await runSlotPlan({ steps: [...images.commands, ...prune.commands] }, effects);
    console.log(
      `gc: ${images.remove.length} unreferenced slot image(s) removed; ` +
        `free disk floor ${GC_FREE_SPACE_FLOOR}`,
    );
    return;
  }

  const baseDomain = requiredBaseDomain();

  console.log(
    await runSlotCommand({
      options: { ...options, actor: process.env.SUDO_USER || process.env.USER },
      registry,
      baseDomain,
      effects,
      // A THUNK: `runSlotCommand` calls it only in the `up`/`sync` branch of `main`.
      // Passing the answer instead made `slot down main` reach into Postgres for a
      // question its plan never asks (Mode (a) NIT, PR #2168).
      databaseExists: () => databaseExists(slotDatabaseName("main")),
    }),
  );
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
