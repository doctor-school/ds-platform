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
// NOT in this part (#2064 part 1): `reset` and `reset-identities`. They are refused
// with an explicit «not implemented until part 2» error — a silent no-op would look
// like a converged identity set to the suite.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, statfsSync, writeFileSync } from "node:fs";
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

/** Where part 2's install script lands the slot compose project on the box. */
export const SLOT_COMPOSE_FILE = "/opt/ds-platform/compose/slot/compose.yml";

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

/** Teardown of a preview database. `main` is never dropped. */
export function dropDatabaseStatements(slot) {
  assertSlotName(slot);
  if (slot === "main") {
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
 * Caddy joins the slot's network so it resolves `<slot>-portal` and friends.
 *
 * Tolerated on failure in both directions: a re-converge finds the container already
 * attached, and a `down` after a partial `up` finds it never attached. Neither is a
 * reason to abandon the rest of the plan.
 */
export function caddyAttachCommand(slot) {
  return {
    kind: "sh",
    label: "attach caddy",
    tolerateFailure: true,
    command: ["docker", "network", "connect", slotNetworkName(slot), CADDY_CONTAINER],
  };
}

export function caddyDetachCommand(slot) {
  return {
    kind: "sh",
    label: "detach caddy",
    tolerateFailure: true,
    command: [
      "docker",
      "network",
      "disconnect",
      slotNetworkName(slot),
      CADDY_CONTAINER,
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
  const commands = remove.length
    ? [
        {
          kind: "sh",
          label: "remove unreferenced slot images",
          tolerateFailure: true,
          command: ["docker", "image", "rm", ...remove],
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
        kind: "sh",
        label: `free disk below ${GC_FREE_SPACE_FLOOR} — pruning unreferenced images`,
        tolerateFailure: true,
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
  ];

  if (slot !== "main") {
    steps.push({
      kind: "sql",
      label: "drop database",
      statements: dropDatabaseStatements(slot),
    });
    if (entry?.sha) {
      steps.push({
        kind: "sh",
        label: "remove slot images",
        tolerateFailure: true,
        command: [
          "docker",
          "image",
          "rm",
          ...Object.values(slotImageRefs(slot, entry.sha)),
        ],
      });
    }
    steps.push({
      kind: "sh",
      label: "remove slot env",
      tolerateFailure: true,
      command: ["rm", "-f", slotEnvPath(slot)],
    });
  }

  return { slot, registry: nextRegistry, steps };
}

// --- the executor ------------------------------------------------------------

/**
 * Runs a plan through injected effects.
 *
 * `sql`, `sh` and `write` are supplied by `main()` and replaced wholesale in the
 * tests, which is what keeps every plan above unit-testable without Postgres, Docker
 * or a filesystem. A step throws unless it declared `tolerateFailure` — a converge
 * that half-failed must not go on to register hostnames.
 */
export async function runSlotPlan(plan, { sql, sh, write, log = () => {} }) {
  for (const step of plan.steps) {
    log(`[${step.label}]`);
    try {
      if (step.kind === "sql") {
        for (const statement of step.statements) await sql(statement, step);
      }
      else if (step.kind === "sh") await sh(step.command, step);
      else if (step.kind === "write") await write(step.path, step.contents, step.mode);
      else if (step.kind === "write-many") {
        for (const file of step.files) await write(file.path, file.contents, file.mode);
      } else throw new SlotError(`unknown step kind: ${step.kind}`);
    } catch (err) {
      if (!step.tolerateFailure) throw err;
      log(`  ↳ tolerated: ${err instanceof Error ? err.message : err}`);
    }
  }
  return plan;
}

// --- CLI ---------------------------------------------------------------------

const COMMANDS_WITH_SLOT_AND_SHA = new Set(["up", "sync"]);
const COMMANDS_WITH_SLOT = new Set(["down"]);
const COMMANDS_WITHOUT_ARGS = new Set(["status", "gc", "render"]);
/** Part 2 (#2064) implements these; refusing beats a silent no-op. */
const DEFERRED_COMMANDS = new Set(["reset", "reset-identities"]);

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command) {
    throw new SlotError(
      "usage: slot up|sync <slot> <sha> | down <slot> | status | gc | render",
    );
  }
  if (DEFERRED_COMMANDS.has(command)) {
    throw new SlotError(
      `\`${command}\` is not implemented until part 2 of #2064 — refusing rather than doing nothing. ` +
        "Until then, reset a preview with `slot down <slot>` followed by `slot up <slot> <sha>`.",
    );
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

function readRegistry() {
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
    write: (path, contents, mode) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, contents, { mode });
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
    console.log(serializeRegistry(registry).trimEnd());
    return;
  }

  if (options.command === "render") {
    const baseDomain = requiredBaseDomain();
    await runSlotPlan(
      { steps: [renderIncludeSteps(registry, baseDomain)] },
      effects,
    );
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

  if (options.command === "down") {
    const plan = planSlotDown({ slot: options.slot, registry, baseDomain });
    await runSlotPlan(plan, effects);
    console.log(`slot ${options.slot} is down`);
    return;
  }

  const plan = planSlotUp({
    slot: options.slot,
    sha: options.sha,
    registry,
    baseDomain,
    action: options.command,
    databaseExists:
      options.slot === "main" ? databaseExists(slotDatabaseName("main")) : undefined,
  });
  await runSlotPlan(plan, effects);
  console.log(
    `slot ${plan.slot} converged on ${shortSha(plan.sha)} (redis db ${plan.redisDb}): ${plan.hosts.join(", ")}`,
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
