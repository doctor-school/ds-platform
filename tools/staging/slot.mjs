#!/usr/bin/env node
// tools/staging/slot.mjs — the slot tool, on the production deploy shape
// (Issue #2194; staging tech spec §3 «Slots» / §5 «Converge» / §8 step 4).
//
// A SLOT is one compose project running the product service set (`api`, `portal`,
// `doctor`, `admin`, `centrifugo`, plus a `migrate` one-shot) from images BUILT ON
// THE BOX out of the slot's own shipped tree — exactly as `tools/deploy/prod.mjs`
// builds production. There is no registry to push to and none to pull from: the tag
// is the full commit SHA, global per commit, and `docker ps` is the single authority
// on which slots are live.
//
// What this module owns:
//   * name derivation — slot → compose project, network, database, hostnames,
//     container aliases, tree directory. Every name is derived, never passed in, so a
//     slot cannot be addressed two ways;
//   * live-state parsing — `parseLiveSlots` over `docker ps`, `parseEnvFile` over the
//     box env files, `parseAvailBytes` over `df`. The box answers; nothing is cached;
//   * remote RENDERING — `quoteCommand` and `remoteWriteScript` turn a plan step into
//     the text one ssh invocation runs. Nothing in this file executes locally;
//   * the ordered plans for `up` / `sync` / `down` / `reset` / `gc`, returned as DATA.
//     Every effect is injected, so every plan above is offline-testable.
//
// Style and guards are `golden-db.mjs`'s: pure planners, one injected executor, a
// thin CLI behind `invokedDirectly`. Database identifiers reuse that module's
// `DB_NAME_RE` / `assertDatabaseName` / `terminateBackendsStatement` rather than a
// second, subtly different guard; the compose service set reuses
// `tools/deploy/service-set.mjs`, the one production already verifies against.
//
// `reset main --yes --ref <sha>` drops `ds_main`, re-clones it from `ds_golden` and
// re-runs the ordinary converge on that SHA; it appends one audit line per run.
// `reset-identities <slot>` converges the golden fixture at the shared Zitadel, writes
// the tool-owned `DS_GOLDEN_SUB_*` file and flushes the slot's Redis logical database.
// Both IdP converges — the whole redirect-URI set on every `up`/`down`, and the golden
// identities — live in `idp.mjs` and arrive here as ONE injected `idp` effect.

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  STALL_BUDGET_BUILD_MS,
  STALL_BUDGET_DEFAULT_MS,
  shipTree,
  sshCapture,
  sshScript,
} from "../deploy/lib/remote.mjs";
import {
  bootProbeSet,
  deployServiceSet,
  shellVarName,
} from "../deploy/service-set.mjs";
import {
  GOLDEN_DB_BASE,
  assertDatabaseName,
  terminateBackendsStatement,
} from "./golden-db.mjs";
import {
  GOLDEN_IDP_ACCOUNTS,
  GOLDEN_SUBJECTS_PATH,
  GOLDEN_SUBJECT_ENV_VARS,
  IDP_PAT_FILE,
  convergeGoldenIdentities,
  convergeRedirectUris,
  createIdpClient,
  parsePinnedUris,
  renderGoldenSubjectsEnv,
  unionUris,
} from "./idp.mjs";

/** Raised for an unusable input or plan — the caller must fail closed. */
export class SlotError extends Error {
  constructor(message) {
    super(message);
    this.name = "SlotError";
  }
}

// --- constants ---------------------------------------------------------------

/**
 * `main` (the merged head) or `pr-<N>` (a preview). Nothing else is a slot.
 *
 * Also the authority `parseLiveSlots` filters compose projects through: a project
 * named `slot-<something else>` is somebody else's, never a slot.
 */
export const SLOT_NAME_RE = /^(?:main|pr-[1-9][0-9]{0,9})$/;

/** A full commit id — the image tag, verbatim, exactly as production tags. */
export const FULL_SHA_RE = /^[0-9a-f]{40}$/;

/**
 * An image this tool may remove: `ds-<repo>:<full sha>`.
 *
 * The tag carries no slot any more (the box builds one image per COMMIT, which two
 * slots converged on the same commit share), so the gc authority is the live image
 * list, not the tag. The `ds-` prefix keeps every shared-infra image — caddy,
 * postgres, zitadel — structurally out of reach of `image rm`.
 */
export const SLOT_IMAGE_RE = /^ds-[a-z0-9][a-z0-9-]*:[0-9a-f]{40}$/;

/** RAM budget, not a preference: §3 «Box» sizes the box for `main` + 3 previews. */
export const PREVIEW_SLOT_CAP = 3;

/** Redis logical databases available to previews; `main` owns 0 (§3 «Slots»). */
export const REDIS_DB_MIN = 1;
export const REDIS_DB_MAX = 15;

/** The shared edge container `slot up` attaches to each slot network. */
export const CADDY_CONTAINER = "stg-infra-caddy-1";

/** The shared Postgres container the CLI reaches `psql` through. */
export const POSTGRES_CONTAINER = "stg-infra-postgres-1";

/**
 * The shared Redis container. One instance, one logical database per slot — so the
 * only per-slot reset is a `FLUSHDB` against that slot's index, never a `FLUSHALL`
 * (which would drop every other slot's sessions, OTP challenges and rate-limit keys).
 */
export const REDIS_CONTAINER = "stg-infra-redis-1";

/** Per-slot, non-secret env files. The box secret set stays in ONE file. */
export const SLOT_ENV_DIR = "/etc/ds-platform/slots";
export const STAGE_ENV_FILE = "/etc/ds-platform/stage.env";

/**
 * One shipped tree per slot, under the deploy user's own home.
 *
 * Production ships to `$HOME/ds-platform` (`tools/deploy/lib/remote.mjs`); a slot
 * ships to `$HOME/ds-platform.slots/<slot>`. The tree is DISPOSABLE — nothing is
 * preserved across ships, because everything durable (the database, the env file,
 * the audit log) lives outside it.
 */
export const SLOT_TREE_ROOT = "$HOME/ds-platform.slots";

/** The ssh destination of the staging box; overridable for an ad-hoc stand. */
export const STAGE_1 = process.env.DS_STAGE_SSH || "ds-stage-1";

/**
 * Compose services that run once and exit.
 *
 * `bootProbeSet` demands a pinned `PORT:` from everything it probes, which is right
 * for a long-running service and meaningless for a one-shot: `migrate` listens on
 * nothing. Filtered out HERE rather than by widening `service-set.mjs`, so the
 * production boot probe keeps its shape unchanged.
 */
export const SLOT_ONE_SHOT_SERVICES = Object.freeze(["migrate"]);

/** Buildx attestations off — production's own build flag (`tools/deploy/prod.mjs`). */
export const NO_ATTEST = "BUILDX_NO_DEFAULT_ATTESTATIONS=1";

/** Production's image retention and BuildKit cache ceiling, not an invented pair. */
export const IMAGE_RETENTION = 3;
export const BUILD_CACHE_RESERVED_SPACE = "10GB";

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
 * Below this much free space on the Docker root, `gc` additionally prunes dangling
 * and unreferenced images. The `ds-*:<sha>` images no live slot runs are removed
 * regardless of free space.
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

/** One shipped tree per slot — disposable, and never shared with another slot. */
export function slotTreeDir(slot) {
  return `${SLOT_TREE_ROOT}/${assertSlotName(slot)}`;
}

/** The compose file inside the slot's OWN tree, at the SHA that tree was shipped at. */
export function slotComposeFile(slot) {
  return `${slotTreeDir(slot)}/infra/deploy/compose/slot/compose.yml`;
}

export function slotEnvPath(slot) {
  return `${SLOT_ENV_DIR}/${assertSlotName(slot)}.env`;
}

// --- live box state ----------------------------------------------------------

/**
 * Which slots are live, read off `docker ps -a`'s compose-project label.
 *
 * The authority used to be a registry FILE, and a file drifts: a container that died,
 * a `compose down` someone ran by hand, a half-failed converge all left the registry
 * claiming a slot that is not there (or hiding one that is). Docker's own labels
 * cannot drift from docker's own state.
 *
 * Input is one `<project>\t<image>` line per container. Projects that are not slots
 * (`stg-infra`, anything hand-run) and dangling containers with no project label are
 * dropped rather than guessed at.
 */
export function parseLiveSlots(stdout) {
  const slots = {};
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [project, image] = line.split("\t");
    if (!project || !project.startsWith("slot-")) continue;
    const name = project.slice("slot-".length);
    if (!SLOT_NAME_RE.test(name)) continue;
    if (!slots[name]) slots[name] = { images: [] };
    const ref = String(image ?? "").trim();
    if (ref && !slots[name].images.includes(ref)) slots[name].images.push(ref);
  }
  return slots;
}

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The box's env files PARSED, never sourced.
 *
 * `stage.env` holds the box secret set and is root-owned; reading it means `sudo cat`
 * over ssh, and what comes back is text. Sourcing it into this process would execute
 * whatever a mis-edit put there; parsing it cannot. A line that is not `KEY=value` is
 * ignored rather than guessed at, and ONE matching pair of surrounding quotes is
 * stripped — the shape `printf '%s=%q'` and a human editor both produce.
 */
export function parseEnvFile(text) {
  const env = {};
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice("export ".length).trim();
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!ENV_KEY_RE.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    const quote = value[0];
    if (
      value.length >= 2 &&
      (quote === '"' || quote === "'") &&
      value.at(-1) === quote
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

/**
 * Free bytes on the BOX, from `df -B1 --output=avail`.
 *
 * The operator runs this tool from a laptop, so `statfs` here would measure the wrong
 * disk entirely and prune (or fail to prune) the box on a number that has nothing to
 * do with it. Output that is not a number throws rather than defaulting to «plenty».
 */
export function parseAvailBytes(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const last = lines.at(-1);
  if (!last || !/^[0-9]+$/.test(last)) {
    throw new SlotError(
      `could not read free space from \`df -B1 --output=avail\`: expected a number, ` +
        `got ${String(text ?? "").slice(0, 120)}`,
    );
  }
  return Number(last);
}

// --- remote rendering --------------------------------------------------------

/** Characters that survive an unquoted shell word unchanged. */
const SHELL_SAFE_RE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/**
 * The ONE expansion a rendered command is allowed to carry.
 *
 * The slot tree lives under the deploy user's home, and the tool does not know what
 * that path is — the box does. Quoting `$HOME/...` would ship the four literal
 * characters; leaving the whole argument unquoted would let a slot name expand
 * something else. So the exception is structural: `$HOME` followed only by path
 * segments of otherwise-safe characters, and nothing else.
 */
const HOME_PATH_RE = /^\$HOME(\/[A-Za-z0-9_@%+=:,.-]+)*$/;

/**
 * An argv rendered as ONE line of shell TEXT.
 *
 * Every command this tool runs happens over ssh, which means every command is text at
 * some point. Rendering it here — once, from an argv — is what keeps a slot name, a
 * SHA or an operator's `$(…)` from ever being interpreted: anything that is not
 * structurally safe is single-quoted, and a single quote inside is closed, escaped and
 * re-opened (`'\''`), which no shell metacharacter can escape from.
 */
export function quoteCommand(argv) {
  return (argv ?? [])
    .map((arg) => {
      const text = String(arg);
      if (SHELL_SAFE_RE.test(text) || HOME_PATH_RE.test(text)) return text;
      return `'${text.replace(/'/g, "'\\''")}'`;
    })
    .join(" ");
}

/** The heredoc delimiter every remote write uses — quoted, so nothing expands. */
export const REMOTE_HEREDOC_DELIMITER = "DS_SLOT_EOF";

/**
 * A file placed on the box as root: `mkdir -p`, `tee` from a quoted heredoc, `chmod`.
 *
 * `sudo cat > path` would open the redirect as the CALLING user and fail on a
 * root-owned directory, so the write goes through `tee`, whose stdout is discarded.
 * The heredoc delimiter is single-quoted, so `$VAR` and backticks in the CONTENTS
 * reach the file verbatim.
 *
 * Two refusals, both about the bytes not matching what was rendered: contents holding
 * a lone delimiter line would end the heredoc early and spill the rest into the shell,
 * and contents with no trailing newline would silently gain one from the heredoc.
 */
export function remoteWriteScript(path, contents, mode, { append = false } = {}) {
  const text = String(contents ?? "");
  if (!text.endsWith("\n")) {
    throw new SlotError(
      `refusing to write ${path}: the contents do not end in a newline, and the heredoc ` +
        "would add one — the bytes on the box would differ from the bytes rendered here",
    );
  }
  if (text.split("\n").some((line) => line === REMOTE_HEREDOC_DELIMITER)) {
    throw new SlotError(
      `refusing to write ${path}: the contents contain a lone \`${REMOTE_HEREDOC_DELIMITER}\` ` +
        "line, which would close the heredoc early",
    );
  }
  const slash = path.lastIndexOf("/");
  const dir = slash > 0 ? path.slice(0, slash) : "/";
  const octal = (Number(mode) & 0o7777).toString(8).padStart(4, "0");
  return [
    `sudo mkdir -p ${dir}`,
    `sudo tee ${append ? "-a " : ""}${path} >/dev/null <<'${REMOTE_HEREDOC_DELIMITER}'`,
    `${text}${REMOTE_HEREDOC_DELIMITER}`,
    `sudo chmod ${octal} ${path}`,
  ].join("\n");
}

// --- Redis logical database allocation --------------------------------------

/**
 * One Redis logical database per slot, `main` = 0.
 *
 * Deterministic from the PR number so a re-converge of the same slot lands on the
 * same database and the previous one is not orphaned. A collision with ANOTHER live
 * slot is probed past, never shared: two slots on one database would cross OTP
 * challenges, session revocation and rate-limit keys, and the failure would look like
 * a product bug.
 *
 * The allocation is computed over the WHOLE set at once, sorted by PR number, rather
 * than «whatever is taken right now» — `docker ps` has no stable order, and an
 * order-dependent probe would hand the same slot different databases on two
 * consecutive runs, stranding its sessions in a database nothing reads.
 */
export function allocateRedisDatabase(slot, liveSlots) {
  assertSlotName(slot);
  if (slot === "main") return 0;
  const names = [...new Set([...Object.keys(liveSlots ?? {}), slot])]
    .filter((name) => name !== "main" && SLOT_NAME_RE.test(name))
    .sort((a, b) => previewNumber(a) - previewNumber(b));
  const span = REDIS_DB_MAX - REDIS_DB_MIN + 1;
  const taken = new Set();
  for (const name of names) {
    const start = REDIS_DB_MIN + (previewNumber(name) % span);
    let assigned = null;
    for (let offset = 0; offset < span; offset += 1) {
      const candidate = REDIS_DB_MIN + ((start - REDIS_DB_MIN + offset) % span);
      if (!taken.has(candidate)) {
        assigned = candidate;
        break;
      }
    }
    if (assigned === null) {
      throw new SlotError(
        `no free Redis database in ${REDIS_DB_MIN}..${REDIS_DB_MAX} for ${name}: ` +
          `${[...taken].sort((a, b) => a - b).join(", ")} are all held. ` +
          "Take a slot down (its PR is closed or draft) and converge again.",
      );
    }
    taken.add(assigned);
    if (name === slot) return assigned;
  }
  throw new SlotError(`no Redis database was allocated for ${slot}`);
}

/** The fourth preview is refused — the box is sized for `main` + 3 (§3 «Box»). */
export function assertPreviewCapacity(slot, liveSlots) {
  assertSlotName(slot);
  if (slot === "main") return slot;
  const live = liveSlots ?? {};
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
 * `allowMain: true` is the ONE caller that may: `slot reset main`, which drops
 * `ds_main` only to re-clone it from `ds_golden` in the same plan. The escape lives
 * here rather than in a second, subtly different DROP builder, so the guard and the
 * statement order stay in one place — and so a future caller has to ask for it by
 * name instead of hand-rolling the SQL.
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
 * `sudo`, because the stand's docker socket is root-owned and every other box command
 * this tool issues is `sudo` too — a mixed set would work for the operator who
 * happens to be in the `docker` group and fail for everyone else.
 *
 * Both env files are passed with `--env-file` so compose INTERPOLATION sees them: the
 * box secret set (`stage.env` — `POSTGRES_PASSWORD`, the Centrifugo pair, the captcha
 * key) and the slot's own non-secret file. That is what lets the slot compose build
 * `DATABASE_URL` from `${POSTGRES_PASSWORD}` + `${SLOT_DB}` without a second on-box
 * copy of the password.
 *
 * `-f` points INTO the slot's own shipped tree: the compose file a slot runs is the
 * one at the commit that slot was converged on, never a shared copy that a later
 * `main` deploy would silently change underneath it.
 */
export function composeBase(slot) {
  return [
    "sudo",
    "docker",
    "compose",
    "--env-file",
    STAGE_ENV_FILE,
    "--env-file",
    slotEnvPath(slot),
    "-p",
    composeProjectName(slot),
    "-f",
    slotComposeFile(slot),
  ];
}

/**
 * The images, BUILT on the box from the shipped tree.
 *
 * This is the whole shape change of #2194: production builds on its own box out of a
 * shipped tree, and staging now does the same. There is no registry in the path, so
 * there is no registry to authenticate to, none to garbage-collect and no window in
 * which the box runs an image the tree it shipped did not produce.
 *
 * `BUILDX_NO_DEFAULT_ATTESTATIONS=1` is production's flag verbatim: attestation
 * manifests make every image a multi-platform index, which `docker image inspect`
 * then cannot resolve to a single id.
 */
export function buildCommandPlan(slot) {
  return {
    kind: "sh",
    label: "build images",
    stallBudget: "build",
    command: ["sudo", NO_ATTEST, ...composeBase(slot).slice(1), "build"],
  };
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
 * The slot's compose service set, read through production's OWN parser.
 *
 * `deployServiceSet` returns only services whose `image:` is `ds-<repo>:${DEPLOY_SHA…}`
 * — which is exactly why the slot compose had to move onto that tag form: the boot
 * probe and the running-image verification are production's, and a second parser with
 * its own idea of what a SHA-tagged service looks like is how the two drift.
 *
 * `migrate` is filtered out of the probe set rather than given a fake `PORT:`: it
 * runs once and exits, so «did it come up on its port» has no honest answer for it.
 */
export function slotServiceSet(text) {
  const services = deployServiceSet(text, { source: "the slot compose" });
  const longRunning = services.filter(
    (service) => !SLOT_ONE_SHOT_SERVICES.includes(service.name),
  );
  return { services, longRunning, bootProbe: bootProbeSet(longRunning) };
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
    "sudo",
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
 * meaning exactly one thing: the slot's hostnames resolve to nothing.
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
          "sudo",
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
 */
export function slotNetworkRemoveCommand(slot) {
  const network = slotNetworkName(slot);
  return {
    kind: "ensure-absent",
    label: "remove slot network",
    items: [
      {
        probe: ["sudo", "docker", "network", "inspect", network],
        remove: ["sudo", "docker", "network", "rm", network],
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
          "sudo",
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

// --- the per-slot env file ---------------------------------------------------

/**
 * The slot's own, NON-SECRET env file.
 *
 * Deliberately no `DATABASE_URL`: it would carry `POSTGRES_PASSWORD` into a second
 * on-box file. The slot compose builds it from `${POSTGRES_PASSWORD}` (interpolated
 * from `stage.env`) and `${SLOT_DB}` from here, so the password lives in exactly one
 * place. Everything else a slot needs that is not slot-specific — the Centrifugo
 * pair, the captcha key, the sink endpoints — comes from `stage.env` directly.
 *
 * `DEPLOY_SHA` is the image tag, the same variable and the same full-SHA value
 * production's compose interpolates. There is no per-slot tag family any more, so
 * there is nothing else for the compose file to resolve an image from.
 *
 * `goldenSubjects` are the five `DS_GOLDEN_SUB_*` ids `reset-identities` wrote to
 * {@link GOLDEN_SUBJECTS_PATH}. They are merged here rather than left to a human,
 * because `seed:golden` resolves them inside the slot's own container and aborts
 * without them. Missing ⇒ a REFUSAL naming `ds-slot reset-identities`, never a blank
 * value: a blank would reach the seed as «provisioned but empty» and fail deep inside
 * a one-shot container instead of here, where the operator can act on it.
 */
export function renderSlotEnv({ slot, sha, baseDomain, redisDb, goldenSubjects }) {
  assertSlotName(slot);
  shortSha(sha);
  const hosts = slotHostnames(slot, baseDomain);
  const missing = GOLDEN_SUBJECT_ENV_VARS.filter((name) => !goldenSubjects?.[name]);
  if (missing.length) {
    throw new SlotError(
      `cannot render the env of slot ${slot}: ${missing.join(", ")} ` +
        `is not in ${GOLDEN_SUBJECTS_PATH} — run \`ds-slot reset-identities ${slot}\` first`,
    );
  }
  return [
    `# generated by tools/staging/slot.mjs for slot ${slot} — do not edit by hand`,
    "# Non-secret only: the box secret set stays in /etc/ds-platform/stage.env.",
    `SLOT=${slot}`,
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
    // Tool-managed and non-secret (`idp.mjs`): the golden fixture's subject ids, which
    // `seed:golden` needs. The golden PASSWORDS are secrets and stay in stage.env.
    ...GOLDEN_SUBJECT_ENV_VARS.map((name) => `${name}=${goldenSubjects[name]}`),
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
 * ADDRESSING ONLY, deliberately: `down` matches containers by project label and never
 * resolves an image tag, so it needs neither `DEPLOY_SHA` nor the golden subjects. A
 * teardown must stay possible on a box where `reset-identities` has never run.
 */
export function renderSlotDownEnv({ slot }) {
  assertSlotName(slot);
  return [
    `# generated by tools/staging/slot.mjs to tear slot ${slot} down — do not edit by hand`,
    "# Only what compose needs to ADDRESS the project: it matches containers by project",
    "# label, never by image tag, so no SHA and no golden subjects are required here.",
    `SLOT=${slot}`,
    `SLOT_DB=${slotDatabaseName(slot)}`,
    "",
  ].join("\n");
}

// --- the shared IdP's redirect-URI set ---------------------------------------

/**
 * Every redirect URI the shared Zitadel app must hold, for the named slots.
 *
 * §3 «Identity» gives the stand ONE Zitadel instance, one project, one client, so a
 * slot's callback works only if it is registered on that shared app — and the
 * registration write is whole-set: a partial list silently drops the others. This
 * seam is that whole set, derived from the live slot names, so the converge can never
 * register one slot by blanking another.
 *
 * The redirect path is the one `renderSlotEnv` hands the api in `IDP_REDIRECT_URI`.
 * The post-logout set is the browser origins of each slot (the api BFF is a callback
 * target, never a logout landing).
 */
export function renderIdpRedirectUris(slotNames, baseDomain) {
  assertBaseDomain(baseDomain);
  const slots = [...new Set(slotNames ?? [])].sort();
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

/**
 * `pins ∪ rendered`, pins first — the whole set the converge writes.
 *
 * Exported and pure so the union has its own test: the write is whole-set, so sending
 * only what the live slots render would unregister the stage's OWN hosts that
 * `infra/dev-stand/idp/provision.sh` put there, and the stage would stop being able to
 * log in the moment a slot came up.
 */
export function resolveDesiredRedirectSet(step, env = process.env) {
  return {
    redirectUris: unionUris(parsePinnedUris(env.IDP_REDIRECT_URIS), step.desired.redirectUris),
    postLogoutUris: unionUris(
      parsePinnedUris(env.IDP_POST_LOGOUT_URIS),
      step.desired.postLogoutUris,
    ),
  };
}

function idpRedirectStep(slotNames, baseDomain) {
  return {
    kind: "idp",
    op: "redirect-uris",
    label: "converge the shared IdP redirect set",
    desired: renderIdpRedirectUris(slotNames, baseDomain),
  };
}

// --- gc ----------------------------------------------------------------------

/**
 * `ds-*:<sha>` images no live slot is running.
 *
 * Live docker state is the authority: an image some live slot lists is in use, every
 * other `ds-<repo>:<sha>` image is garbage. Shared-infra images (caddy, postgres,
 * zitadel…) never match `SLOT_IMAGE_RE`, so a gc run structurally cannot take the
 * stand down.
 */
export function planUnreferencedImageGc({ images, liveSlots }) {
  const inUse = new Set(
    Object.values(liveSlots ?? {}).flatMap((entry) => entry?.images ?? []),
  );
  const remove = [...new Set((images ?? []).map(String))].filter(
    (ref) => SLOT_IMAGE_RE.test(ref) && !inUse.has(ref),
  );
  // Same shape as the teardown's image removal: an image a previous `gc` or `down`
  // already took is the desired end state, while one that is there and refuses to go
  // (still referenced by a stopped container) is an operator's problem, not a shrug.
  const commands = remove.length
    ? [
        {
          kind: "ensure-absent",
          label: "remove unreferenced slot images",
          items: remove.map((ref) => ({
            probe: ["sudo", "docker", "image", "inspect", ref],
            remove: ["sudo", "docker", "image", "rm", ref],
          })),
        },
      ]
    : [];
  return { remove, commands };
}

/**
 * Live preview slots whose PR is no longer open — the ones `gc` takes down.
 *
 * `main` is never a candidate: it is the merged head, not a preview, and no PR number
 * could ever close it.
 */
export function slotsWithClosedPrs(liveSlots, openPrNumbers) {
  const open = new Set((openPrNumbers ?? []).map(Number));
  return Object.keys(liveSlots ?? {})
    .filter((name) => name !== "main" && !open.has(previewNumber(name)))
    .sort();
}

/**
 * The second, CONDITIONAL half of gc — see `GC_FREE_SPACE_FLOOR`.
 *
 * Above the floor nothing runs: an unconditional prune on a healthy box throws away
 * the build cache the next slot build would reuse.
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
        command: ["sudo", "docker", "image", "prune", "-af", "--filter", "until=24h"],
      },
    ],
  };
}

// --- reset-identities --------------------------------------------------------

/** The one audit line `reset-identities` appends. Pure, so its shape is testable. */
export function resetIdentitiesLogLine({ slot, actor, now = new Date() }) {
  return `${now.toISOString()} reset-identities ${slot} by ${actor || "unknown"}\n`;
}

/**
 * `reset-identities <slot>` — the golden fixture put back the way the scenarios expect.
 *
 * The IdP half (create/delete/password/verify at the shared Zitadel) happens in the
 * `idp` effect BEFORE this plan is built, because its output — the five subject ids —
 * is this plan's input. What is left is the box-local half, and its order is the point:
 *
 * 1. write the tool-owned `DS_GOLDEN_SUB_*` file (0644, non-secret: opaque ids, never
 *    passwords) so the next `slot up` renders a slot env that `seed:golden` can resolve;
 * 2. FLUSH the slot's Redis logical database — a rebuilt account keeps its username but
 *    gets a NEW subject, so every session, OTP challenge and rate-limit key keyed on the
 *    old one is stale. Leaving them behind is how a «the fixture is reset» run still
 *    fails on a half-live session;
 * 3. append one audit line.
 *
 * A preview that is not live is refused rather than defaulted: it owns no Redis
 * database, so «flush its database» has no honest answer.
 */
export function planResetIdentities({ slot, liveSlots, subjects, actor, now = new Date() }) {
  assertSlotName(slot);
  if (slot !== "main" && !liveSlots?.[slot]) {
    throw new SlotError(
      `refusing to reset the identities of \`${slot}\`: it is not running, so it ` +
        "owns no Redis logical database to flush. Bring it up first with " +
        `\`ds-slot up ${slot} --ref <sha>\`.`,
    );
  }
  const redisDb = allocateRedisDatabase(slot, liveSlots);
  const steps = [
    {
      kind: "write",
      label: "write the tool-owned golden subjects",
      path: GOLDEN_SUBJECTS_PATH,
      contents: renderGoldenSubjectsEnv(subjects),
      mode: 0o644,
    },
    {
      kind: "sh",
      label: "flush the slot's redis logical database",
      command: [
        "sudo",
        "docker",
        "exec",
        REDIS_CONTAINER,
        "redis-cli",
        "-n",
        String(redisDb),
        "FLUSHDB",
      ],
    },
    {
      kind: "append",
      label: "audit the identity reset",
      path: SLOT_LOG_PATH,
      contents: resetIdentitiesLogLine({ slot, actor, now }),
      mode: 0o640,
    },
  ];
  return { slot, redisDb, subjects, steps };
}

// --- the ordered plans -------------------------------------------------------

/**
 * `up` / `sync` — the converge, in the only order that is safe.
 *
 * The tree ships FIRST: everything after it — the build, the migrate image, the
 * compose file itself — comes out of that tree, so a ship that failed must stop the
 * converge before anything on the box changes.
 *
 * The IdP converge comes AFTER `up -d` and the Caddy attach: a callback registered
 * for a host that answers 502 is worse than one registered a few seconds later. The
 * health check and the prune close the run, exactly as `tools/deploy/prod.mjs` orders
 * them, and the identity reset tail leaves the golden fixture in the state the
 * scenarios expect.
 */
export function planSlotUp({
  slot,
  sha,
  liveSlots,
  baseDomain,
  action = "up",
  databaseExists,
  subjects,
  actor,
  now = new Date(),
}) {
  assertSlotName(slot);
  shortSha(sha);
  assertBaseDomain(baseDomain);
  if (action !== "up" && action !== "sync") {
    throw new SlotError(`unknown converge action: ${JSON.stringify(action)}`);
  }
  const live = liveSlots ?? {};
  assertPreviewCapacity(slot, live);
  const redisDb = allocateRedisDatabase(slot, live);
  const hostMap = slotHostnames(slot, baseDomain);
  const hosts = Object.values(hostMap);

  const steps = [
    {
      kind: "ship",
      label: "ship the tree",
      sha,
      liveDir: slotTreeDir(slot),
      // Nothing survives a ship: the slot tree holds no state. The database, the env
      // file and the audit log all live outside it.
      preserved: [],
      tmpPrefix: `ds-slot-${slot}`,
    },
    {
      kind: "write",
      label: "write slot env",
      path: slotEnvPath(slot),
      contents: renderSlotEnv({
        slot,
        sha,
        baseDomain,
        redisDb,
        goldenSubjects: subjects,
      }),
      mode: 0o640,
    },
    buildCommandPlan(slot),
    { kind: "verify-images", label: "verify images boot", sha, slot },
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
    migrateCommandPlan(slot),
    seedCommandPlan(slot),
    upCommandPlan(slot),
    caddyAttachCommand(slot),
    idpRedirectStep([...Object.keys(live), slot], baseDomain),
    { kind: "verify-running", label: "verify the running images", sha, slot },
    {
      kind: "health",
      label: "health",
      slot,
      sha,
      url: `https://${hostMap.api}/v1/health`,
    },
    {
      kind: "prune",
      label: "prune images and build cache",
      retention: IMAGE_RETENTION,
      reservedSpace: BUILD_CACHE_RESERVED_SPACE,
    },
    // The slot IS live by the time this tail runs, so `planResetIdentities` is given
    // the live set it will have — not the one docker reported before the converge.
    ...planResetIdentities({
      slot,
      liveSlots: { ...live, [slot]: live[slot] ?? { images: [] } },
      subjects,
      actor,
      now,
    }).steps,
  );

  return { slot, sha, redisDb, hosts, steps };
}

/**
 * `down` — detach the edge first, tear the slot down after, converge the IdP last.
 *
 * The image removal is the subtle half. Image tags are global per COMMIT now, so two
 * slots converged on one SHA share every tag: removing «this slot's images» on the
 * old, registry-derived reasoning would take the other slot down with an
 * ImageNotFound on its next restart. So the candidates are this slot's images MINUS
 * every image any other live slot lists, and when nothing is left the step is absent
 * from the plan entirely rather than present and empty.
 */
export function planSlotDown({ slot, liveSlots, baseDomain, now = new Date() }) {
  assertSlotName(slot);
  assertBaseDomain(baseDomain);
  void now;
  const live = liveSlots ?? {};

  const steps = [
    {
      kind: "write",
      label: "ensure slot env",
      path: slotEnvPath(slot),
      contents: renderSlotDownEnv({ slot }),
      mode: 0o640,
    },
    caddyDetachCommand(slot),
    downCommandPlan(slot),
    slotNetworkRemoveCommand(slot),
  ];

  if (slot !== "main") {
    steps.push({
      kind: "sql",
      label: "drop database",
      statements: dropDatabaseStatements(slot),
    });
    const stillReferenced = new Set(
      Object.entries(live)
        .filter(([name]) => name !== slot)
        .flatMap(([, entry]) => entry?.images ?? []),
    );
    const orphaned = [
      ...new Set((live[slot]?.images ?? []).filter((ref) => SLOT_IMAGE_RE.test(ref))),
    ].filter((ref) => !stillReferenced.has(ref));
    if (orphaned.length) {
      steps.push({
        kind: "ensure-absent",
        label: "remove slot images",
        items: orphaned.map((ref) => ({
          probe: ["sudo", "docker", "image", "inspect", ref],
          remove: ["sudo", "docker", "image", "rm", ref],
        })),
      });
    }
    steps.push(
      {
        // `rm -rf` and `rm -f` are already idempotent; nothing to probe.
        kind: "sh",
        label: "remove the slot tree",
        command: ["sudo", "rm", "-rf", slotTreeDir(slot)],
      },
      {
        kind: "sh",
        label: "remove slot env",
        command: ["sudo", "rm", "-f", slotEnvPath(slot)],
      },
    );
  }

  // Last, over the slots that REMAIN: the torn-down slot's callback is gone from the
  // shared app rather than left pointing at nothing.
  steps.push(
    idpRedirectStep(
      Object.keys(live).filter((name) => name !== slot),
      baseDomain,
    ),
  );

  return { slot, steps };
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
 * The SHA is an ARGUMENT (`--ref`), not a lookup: there is no registry holding «what
 * main was converged on» any more, and inferring it from a running container's tag
 * would re-converge on whatever happened to be up rather than on what the operator
 * meant.
 *
 * Order: audit line FIRST, then the containers down, then the drop/clone, then the
 * ordinary converge. The audit line is written before anything is destroyed on
 * purpose — a line that only lands when the wipe succeeds cannot answer «who ran the
 * thing that broke the box halfway through».
 */
export function planSlotReset({
  sha,
  liveSlots,
  baseDomain,
  actor,
  subjects,
  now = new Date(),
}) {
  assertBaseDomain(baseDomain);
  if (!sha) {
    throw new SlotError(
      "refusing to reset `main`: there is no SHA to re-converge on. Name it with " +
        "`ds-slot reset main --yes --ref <sha>`.",
    );
  }
  shortSha(sha);
  // `databaseExists: true` — the drop/clone below re-creates it in the same plan, so
  // the converge that follows must NOT emit a second clone.
  const up = planSlotUp({
    slot: "main",
    sha,
    liveSlots,
    baseDomain,
    action: "up",
    databaseExists: true,
    subjects,
    actor,
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
    // The containers come DOWN before the drop: one `psql` runs per statement, so a
    // running api's pool re-opens a session on `ds_main` between the terminate and the
    // DROP and Postgres answers 55006 — a reset that aborts AFTER the audit line was
    // already written. `up.steps` below brings the slot back on the named SHA.
    downCommandPlan("main"),
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
  return { slot: "main", sha, redisDb: up.redisDb, hosts: up.hosts, steps };
}

// --- the executor ------------------------------------------------------------

/** The remote-only step kinds, each naming the effect that must supply it. */
const REMOTE_ONLY_KINDS = Object.freeze({
  ship: "ship",
  "verify-images": "verifyImages",
  "verify-running": "verifyRunning",
  health: "health",
  prune: "prune",
});

/**
 * Runs a plan through injected effects.
 *
 * Every effect is supplied by `main()` and replaced wholesale in the tests, which is
 * what keeps every plan above unit-testable without ssh, Postgres or Docker.
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
 * The five REMOTE-ONLY kinds (`ship`, `verify-images`, `verify-running`, `health`,
 * `prune`) have no offline fallback at all — each one is a multi-command remote
 * routine, not a single argv — so a missing effect refuses BY NAME rather than
 * skipping the step. A converge that silently skipped its verification would report
 * success for a slot running the previous commit's images.
 */
export async function runSlotPlan(
  plan,
  {
    sql,
    sh,
    write,
    append,
    probe,
    idp,
    ship,
    verifyImages,
    verifyRunning,
    health,
    prune,
    log = () => {},
  },
) {
  const remoteEffects = {
    ship,
    verifyImages,
    verifyRunning,
    health,
    prune,
  };

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
    } else if (step.kind === "idp") {
      if (!idp) {
        throw new SlotError(
          `step "${step.label}" talks to the shared Zitadel and so needs an \`idp\` ` +
            "effect; there is no offline fallback, because an unregistered redirect URI " +
            "fails every login with `invalid redirect_uri`.",
        );
      }
      step.result = await idp(step);
    } else if (REMOTE_ONLY_KINDS[step.kind]) {
      const name = REMOTE_ONLY_KINDS[step.kind];
      const effect = remoteEffects[name];
      if (!effect) {
        throw new SlotError(
          `step "${step.label}" runs on the box and so needs a \`${name}\` effect; ` +
            "there is no offline fallback for it",
        );
      }
      step.result = await effect(step);
    } else throw new SlotError(`unknown step kind: ${step.kind}`);
  }
  return plan;
}

/**
 * The converge/teardown half of the CLI, lifted out of `main()` so the branches
 * themselves are testable with injected effects.
 *
 * Returns the line `main()` prints; failure is a throw, exactly as inside a plan.
 */
export async function runSlotCommand({
  options,
  liveSlots,
  baseDomain,
  effects,
  databaseExists: mainDatabaseExists,
}) {
  if (options.command === "down") {
    // A teardown needs NO golden identities: it must stay possible on a box where the
    // fixture never converged, and on one where the shared Zitadel is unreachable.
    const plan = planSlotDown({ slot: options.slot, liveSlots, baseDomain });
    await runSlotPlan(plan, effects);
    return `slot ${options.slot} is down`;
  }

  if (!effects?.idp) {
    throw new SlotError(
      `\`${options.command}\` converges the golden fixture at the shared Zitadel and so ` +
        "needs an `idp` effect",
    );
  }
  // The converge runs FIRST and its subjects are every plan's input: writing a slot env
  // (or the subjects file) before the IdP agrees with it would leave the box claiming
  // subject ids that the identity provider does not hold.
  const subjects = await effects.idp({
    op: "golden-identities",
    label: "converge the golden identities",
  });

  if (options.command === "reset-identities") {
    const plan = planResetIdentities({
      slot: options.slot,
      liveSlots,
      subjects,
      actor: options.actor,
    });
    await runSlotPlan(plan, effects);
    return (
      `golden identities converged: ${GOLDEN_SUBJECTS_PATH} rewritten and redis db ` +
      `${plan.redisDb} (slot ${plan.slot}) flushed`
    );
  }

  if (options.command === "reset") {
    const plan = planSlotReset({
      sha: options.sha,
      liveSlots,
      baseDomain,
      actor: options.actor,
      subjects,
    });
    await runSlotPlan(plan, effects);
    return (
      `slot main was reset from ${GOLDEN_DB_BASE} and re-converged on ` +
      `${shortSha(plan.sha)}: ${plan.hosts.join(", ")}`
    );
  }

  // Lazily: `databaseExists` may be a thunk, and it is asked ONLY here — inside the
  // `up`/`sync` branch, and only for `main`. A preview never asks, so a teardown or a
  // preview converge never depends on a healthy Postgres to answer it.
  const databaseExists =
    options.slot === "main" && typeof mainDatabaseExists === "function"
      ? await mainDatabaseExists()
      : mainDatabaseExists;
  const plan = planSlotUp({
    slot: options.slot,
    sha: options.sha,
    liveSlots,
    baseDomain,
    action: options.command,
    databaseExists,
    subjects,
    actor: options.actor,
  });
  await runSlotPlan(plan, effects);
  return (
    `slot ${plan.slot} converged on ${shortSha(plan.sha)} ` +
    `(redis db ${plan.redisDb}): ${plan.hosts.join(", ")}`
  );
}

// --- CLI ---------------------------------------------------------------------

const COMMANDS_WITH_SLOT_AND_REF = new Set(["up", "sync"]);
const COMMANDS_WITH_SLOT = new Set(["down", "reset-identities"]);
const COMMANDS_WITHOUT_ARGS = new Set(["status", "gc"]);

/** `--ref <sha>` out of a flag list, or `undefined`. Unknown flags are refused. */
function takeRef(flags, { allowed }) {
  let sha;
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    if (flag === "--ref") {
      sha = flags[index + 1];
      index += 1;
      if (!sha) throw new SlotError("`--ref` requires a full commit SHA");
      shortSha(sha);
      continue;
    }
    if (!allowed.includes(flag)) throw new SlotError(`unknown option: ${flag}`);
  }
  return sha;
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command) {
    throw new SlotError(
      "usage: ds-slot up|sync <slot> --ref <sha> | down <slot> | " +
        "reset main --yes --ref <sha> | reset-identities <slot> | status | gc",
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
          "is re-cloned from `ds_golden` on every converge, so `ds-slot sync " +
          `${slot} --ref <sha>\` already is its reset.`,
      );
    }
    const sha = takeRef(flags, { allowed: ["--yes", "--ref"] });
    if (!flags.includes("--yes")) {
      throw new SlotError(
        "refusing to reset `main` without `--yes`: this DROPS `ds_main` and re-clones it " +
          "from `ds_golden`, discarding everything staging has accumulated there.",
      );
    }
    return { command, slot, sha, yes: true };
  }
  if (COMMANDS_WITH_SLOT_AND_REF.has(command)) {
    const [slot, ...flags] = rest;
    if (!slot) throw new SlotError(`\`${command}\` requires <slot> and \`--ref <sha>\``);
    assertSlotName(slot);
    // A BARE positional SHA is an error, not a second spelling: the commit a slot is
    // converged on is the one thing the preview workflow passes by hand, and two
    // spellings is how a workflow edit ends up shipping the wrong ref silently.
    const sha = takeRef(flags, { allowed: [] });
    if (!sha) {
      throw new SlotError(
        `\`${command}\` requires \`--ref <sha>\` — a full 40-character commit id`,
      );
    }
    return { command, slot, sha };
  }
  if (COMMANDS_WITH_SLOT.has(command)) {
    const [slot, ...flags] = rest;
    if (!slot) throw new SlotError(`\`${command}\` requires <slot>`);
    assertSlotName(slot);
    if (flags.length) throw new SlotError(`unknown option: ${flags[0]}`);
    return { command, slot, sha: undefined };
  }
  if (COMMANDS_WITHOUT_ARGS.has(command)) {
    if (rest.length) throw new SlotError(`\`${command}\` takes no arguments`);
    return { command, slot: undefined, sha: undefined };
  }
  throw new SlotError(`unknown command: ${command}`);
}

/**
 * The shared Zitadel's origin.
 *
 * `stage.env` deliberately carries NO `IDP_BASE_URL`: `stg-infra` passes the base URL to
 * `provision.sh` explicitly, and a hand-placed key here could drift from the issuer Caddy
 * actually serves. What the box DOES carry is the `IDP_EXTERNAL_DOMAIN` /
 * `IDP_EXTERNAL_PORT` / `IDP_EXTERNAL_SECURE` trio, which IS the authoritative origin of
 * the shared IdP — `IDP_EXTERNAL_DOMAIN` must equal the Caddy `id` vhost or OIDC discovery
 * advertises a wrong issuer. So derive the origin from that trio, and keep `IDP_BASE_URL`
 * as an explicit override for ad-hoc runs.
 */
export function resolveIdpBaseUrl(env = process.env) {
  const override = (env.IDP_BASE_URL ?? "").trim();
  if (override) return override.replace(/\/+$/, "");

  const domain = (env.IDP_EXTERNAL_DOMAIN ?? "").trim();
  if (domain) {
    const flag = (env.IDP_EXTERNAL_SECURE ?? "").trim().toLowerCase();
    const secure = flag === "true" || flag === "1";
    const scheme = secure ? "https" : "http";
    const defaultPort = secure ? "443" : "80";
    const port = (env.IDP_EXTERNAL_PORT ?? "").trim();
    const suffix = port && port !== defaultPort ? `:${port}` : "";
    return `${scheme}://${domain}${suffix}`;
  }

  throw new SlotError(
    "the shared IdP origin is not resolvable: set IDP_BASE_URL, or the " +
      "IDP_EXTERNAL_DOMAIN / IDP_EXTERNAL_PORT / IDP_EXTERNAL_SECURE trio, in " +
      "/etc/ds-platform/stage.env",
  );
}

// --- the box ------------------------------------------------------------------

/** One `sudo cat` over ssh, parsed — never sourced. See `parseEnvFile`. */
async function readBoxEnvFile(path, { optional = false } = {}) {
  try {
    return parseEnvFile(await sshCapture(STAGE_1, `sudo cat ${path}`));
  } catch (err) {
    if (optional) return {};
    throw err;
  }
}

/** The bootstrap PAT, from the root-only file the stage provisioning writes. */
async function readIdpPat() {
  let pat;
  try {
    pat = (await sshCapture(STAGE_1, `sudo cat ${IDP_PAT_FILE}`)).trim();
  } catch {
    throw new SlotError(
      `${IDP_PAT_FILE} is not readable on ${STAGE_1} — the IdP bootstrap PAT is placed ` +
        "there by the stage provisioning; this tool never mints one",
    );
  }
  if (!pat) throw new SlotError(`${IDP_PAT_FILE} is empty on ${STAGE_1}`);
  return pat;
}

/** Which slots are live, straight from docker's own labels. */
async function readLiveSlots() {
  return parseLiveSlots(
    await sshCapture(
      STAGE_1,
      `sudo docker ps -a --format '{{.Label "com.docker.compose.project"}}\\t{{.Image}}'`,
    ),
  );
}

async function readBoxImages() {
  const out = await sshCapture(
    STAGE_1,
    "sudo docker image ls --format '{{.Repository}}:{{.Tag}}'",
  );
  return out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

async function readBoxFreeBytes() {
  return parseAvailBytes(
    await sshCapture(STAGE_1, `sudo df -B1 --output=avail ${DOCKER_ROOT}`),
  );
}

async function boxDatabaseExists(name) {
  const out = await sshCapture(
    STAGE_1,
    quoteCommand([
      "sudo",
      "docker",
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
    ]),
  );
  return out.trim() === "1";
}

// --- the five remote-only routines -------------------------------------------
//
// Each one is a multi-command remote routine rather than a single argv, which is why
// the executor refuses them BY NAME when the effect is absent. The scripts and the
// verdict readers are pure functions, exported and unit-tested, so the text that
// reaches the box is asserted offline exactly as every plan above is.

/**
 * PRE-SWAP boot verify — `tools/deploy/prod.mjs` `verifyImagesBoot`, slot-scoped.
 *
 * The freshly built images are run as throwaway DETACHED containers with the same two
 * `env_file`s the slot compose gives them, and each must answer non-5xx on `/` from
 * inside the container. An image that does not boot aborts the converge while the
 * slot's PREVIOUS containers are still up — the reviewer's preview never sees it.
 *
 * No published ports, no compose network, and a name scoped to the slot: two slots
 * converging the same commit at the same time must not collide on one probe container.
 */
export function verifyImagesScript({ slot, sha, services }) {
  assertSlotName(slot);
  shortSha(sha);
  return `probe() {
  svc="$1"; repo="$2"; port="$3"
  name="ds-slotcheck-${slot}-$svc"
  sudo docker rm -f "$name" >/dev/null 2>&1 || true
  # -e PORT after the env files on purpose: an explicit -e outranks an --env-file,
  # the same precedence compose \`environment:\` has over \`env_file:\` (DSO-100).
  if ! sudo docker run -d --name "$name" \\
        --env-file ${STAGE_ENV_FILE} --env-file ${slotEnvPath(slot)} \\
        -e PORT="$port" -e HOSTNAME=0.0.0.0 "$repo:${sha}" >/dev/null 2>&1; then
    echo "$svc=NOSTART"; return
  fi
  deadline=$(( $(date +%s) + 120 ))
  status=PENDING
  while [ "$status" = PENDING ]; do
    running=$(sudo docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null || echo false)
    if sudo docker exec "$name" node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
      status=OK
    elif [ "$running" != true ]; then
      status=EXITED
    elif [ "$(date +%s)" -ge "$deadline" ]; then
      status=TIMEOUT
    else
      sleep 3
    fi
  done
  echo "$svc=$status"
  if [ "$status" != OK ]; then
    echo "---- $svc boot log (last 60) ----"
    sudo docker logs --tail 60 "$name" 2>&1 || true
  fi
  sudo docker rm -f "$name" >/dev/null 2>&1 || true
}
${services.map((service) => `probe ${service.name} ${service.image} ${service.port}`).join("\n")}`;
}

/**
 * Reads the probe's `<service>=<status>` lines.
 *
 * A service the box printed NO verdict for is a failure, never a pass: truncated
 * output must not read as «everything booted».
 */
export function assertImagesBoot(stdout, services) {
  const names = services.map((service) => service.name);
  const verdicts = Object.fromEntries(
    String(stdout ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim().match(/^([A-Za-z0-9._-]+)=(\w+)$/))
      .filter((match) => match && names.includes(match[1]))
      .map((match) => [match[1], match[2]]),
  );
  const bad = names.filter((name) => verdicts[name] !== "OK");
  if (bad.length > 0) {
    throw new SlotError(
      `freshly built image(s) do NOT boot: ${bad
        .map((name) => `${name}=${verdicts[name] ?? "NO-VERDICT"}`)
        .join(", ")}\n` +
        "  Nothing was swapped — the slot's PREVIOUS containers are still up.",
    );
  }
  return verdicts;
}

/**
 * Truthful-success gate — `tools/deploy/prod.mjs` `verifyRunningSha`, slot-scoped.
 *
 * Runs AFTER `up -d` and proves the RUNNING containers carry the converged SHA's
 * images AND reached `healthy`. Without it a converge could report a slot on the
 * PR's commit while the box still runs the previous one.
 *
 * Containers are addressed by `container_name` (`<slot>-<service>`, the contract
 * `containerAliases` owns and the Caddy snippet dials), not by compose's
 * `<project>-<service>-1` default, which the slot compose overrides.
 */
export function verifyRunningScript({ slot, sha, services }) {
  assertSlotName(slot);
  shortSha(sha);
  const container = (name) => `${slot}-${name}`;
  const reads = services
    .map(
      (service) =>
        `  ${shellVarName(service.name)}_img=$(sudo docker inspect ${container(service.name)} --format '{{.Config.Image}}' 2>/dev/null || echo absent)\n` +
        `  ${shellVarName(service.name)}_h=$(sudo docker inspect ${container(service.name)} --format '{{.State.Health.Status}}' 2>/dev/null || echo absent)`,
    )
    .join("\n");
  const state = services
    .map(
      (service) =>
        `${service.name}=$${shellVarName(service.name)}_img($${shellVarName(service.name)}_h)`,
    )
    .join(" ");
  const condition = services
    .map(
      (service) =>
        `[ "$${shellVarName(service.name)}_img" = "${service.image}:${sha}" ] && [ "$${shellVarName(service.name)}_h" = healthy ]`,
    )
    .join(" \\\n     && ");
  return `deadline=$(( $(date +%s) + 240 ))
while true; do
${reads}
  state="${state}"
  if ${condition}; then
    echo "OK $state"; break
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "TIMEOUT $state"; break
  fi
  sleep 5
done`;
}

export function assertRunningVerdict(stdout, { slot, sha }) {
  const out = String(stdout ?? "").trim();
  if (out.startsWith("OK ")) return out;
  throw new SlotError(
    `slot ${slot}: the running containers do NOT carry ${shortSha(sha)} (or never got healthy):\n` +
      `  ${out || "(no verdict line)"}\n` +
      "  A converged line would be a lie — treating this converge as FAILED.",
  );
}

/**
 * Image retention + BuildKit cache cap — production's `prune_repo` verbatim.
 *
 * The repo list is DERIVED from the box rather than hard-coded the way production
 * hard-codes its four: a slot converges arbitrary branches, and a branch that adds a
 * service would otherwise leak every tag of that repo forever. `ds-` scoping keeps
 * the shared-infra images (caddy, postgres, zitadel) structurally out of reach.
 *
 * `docker rmi` REFUSES an image a container still uses, which is what keeps retention
 * from pulling an older commit's images out from under another live slot; that
 * refusal is the swallowed `|| true`, exactly as in production.
 */
export function pruneScript({ retention, reservedSpace }) {
  return `prune_repo() {
  repo="$1"; keep="$2"
  # \`|| true\` on grep: under pipefail a grep that filters out EVERY line (only
  # \`:local\` tags exist yet) exits 1. "Nothing to prune" is success, not failure.
  sudo docker images "$repo" --format '{{.CreatedAt}}\\t{{.Tag}}' \\
    | { grep -vP '\\tlocal$' || true; } \\
    | sort -r \\
    | awk -v k="$keep" -F'\\t' 'NR>k{print $2}' \\
    | while IFS= read -r tag; do
        [ -n "$tag" ] && sudo docker rmi "$repo:$tag" >/dev/null 2>&1 || true
      done
}
sudo docker images --format '{{.Repository}}' \\
  | { grep -E '^ds-[a-z0-9][a-z0-9-]*$' || true; } \\
  | sort -u \\
  | while IFS= read -r repo; do
      if [ -n "$repo" ]; then prune_repo "$repo" ${retention}; fi
    done
# \`buildx prune --reserved-space\`, NOT \`builder prune --filter until=\`: on the
# containerd snapshotter the \`until=\` filter can silently reclaim 0 bytes (#1419).
sudo docker buildx prune -f --reserved-space ${reservedSpace} || true
echo "build cache after prune:"; sudo docker system df --format '  {{.Type}}: {{.Size}} (reclaimable {{.Reclaimable}})' || true
`;
}

/** How long the converge waits for the slot's api to serve the converged SHA. */
export const HEALTH_DEADLINE_MS = 120_000;
export const HEALTH_POLL_MS = 5_000;
export const HEALTH_TIMEOUT_MS = 15_000;

/**
 * The external health verdict: what the slot's PUBLIC api hostname actually serves.
 *
 * `verifyRunningScript` above proves the box's own view; this proves the edge —
 * Caddy routing, the certificate and the slot's basic-auth gate — because a slot a
 * reviewer cannot reach is not converged, however healthy the container is.
 */
export function healthVerdict({ status, body, sha }) {
  if (status !== 200) {
    return { ok: false, reason: `HTTP ${status}` };
  }
  let json;
  try {
    json = JSON.parse(String(body ?? ""));
  } catch {
    return { ok: false, reason: "the health response was not JSON" };
  }
  const version =
    json && typeof json === "object" && typeof json.version === "string"
      ? json.version.trim()
      : "";
  if (version === "") {
    return { ok: false, reason: "the health response carried no `.version`" };
  }
  if (version !== sha) {
    return {
      ok: false,
      reason: `serving ${version.slice(0, 12)}, expected ${shortSha(sha)}`,
    };
  }
  return { ok: true, reason: `/v1/health reports ${shortSha(sha)}` };
}

/**
 * The stand's basic-auth password, from the OPERATOR's machine.
 *
 * The box stores only the bcrypt hash (`STAGE_BASIC_AUTH_HASH`, the Caddyfile's
 * `staging_basic_auth`), so the plaintext cannot come from `stage.env` — the health
 * assertion would authenticate with nothing and read Caddy's 401 as an outage. Absent
 * ⇒ a named refusal, never a skipped verification.
 */
export function requiredOperatorPassword(env) {
  const password = env?.STAGE_BASIC_AUTH_PASS;
  if (!password) {
    throw new SlotError(
      "STAGE_BASIC_AUTH_PASS is not set on THIS machine — the stand sits behind one " +
        "basic-auth pair and the box holds only its bcrypt hash, so the health check " +
        "cannot authenticate without the plaintext. Export it and re-run.",
    );
  }
  return password;
}

export function basicAuthHeader(user, password) {
  return `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The slot's service set, read off the compose file IN ITS OWN SHIPPED TREE.
 *
 * Never off the local checkout: the operator's working tree may be many commits away
 * from the slot's, and a service that branch does not declare cannot be verified. An
 * unreadable compose is a refusal, never an assumed set.
 */
async function readSlotServices(slot) {
  let text;
  try {
    text = await sshCapture(STAGE_1, quoteCommand(["cat", slotComposeFile(slot)]));
  } catch (e) {
    throw new SlotError(
      `cannot read ${slotComposeFile(slot)} on ${STAGE_1} (${e.message}) — without the ` +
        "shipped tree's own compose there is no authority on which images this slot runs",
    );
  }
  return slotServiceSet(text);
}

/** One health read; every failure degrades to a verdict, so the poll can retry it. */
async function probeSlotHealth(url, headers, sha) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    return healthVerdict({ status: res.status, body: await res.text(), sha });
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The effects, all of them over ssh — except `health`, which must come in through the
 * public edge the way a reviewer does.
 *
 * The five REMOTE-ONLY ones are the routines above: `ship` streams a `git archive` of
 * the committed SHA into the slot's disposable tree, `verifyImages` boot-probes the
 * freshly built images BEFORE the swap, `verifyRunning` proves the running containers
 * carry that SHA and are healthy AFTER it, `health` asserts the public api serves it,
 * and `prune` caps the box's images and BuildKit cache. Each one reads the slot's own
 * shipped compose for its service set, so a branch that adds or drops a service is
 * verified against what that branch actually declares.
 */
function realEffects(boxEnv) {
  const run = (script, step) =>
    sshScript(STAGE_1, script, {
      label: step?.label ?? "slot",
      stallBudgetMs:
        step?.stallBudget === "build" ? STALL_BUDGET_BUILD_MS : STALL_BUDGET_DEFAULT_MS,
    });
  return {
    sql: (statement, step) =>
      run(
        quoteCommand([
          "sudo",
          "docker",
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
        ]),
        step,
      ),
    sh: (command, step) => run(quoteCommand(command), step),
    // The probe REPORTS the exit status instead of throwing on it — «not found» is an
    // answer, not an error. `sshCapture` rejects on a non-zero exit, so the status is
    // captured INSIDE the script and comes back on its own first line.
    probe: async (command) => {
      const captured = await sshCapture(
        STAGE_1,
        [
          `if out=$(${quoteCommand(command)} 2>/dev/null); then echo DS_PROBE_OK; else echo DS_PROBE_FAIL; fi`,
          `printf '%s' "$out"`,
        ].join("\n"),
      );
      const newline = captured.indexOf("\n");
      const head = newline === -1 ? captured : captured.slice(0, newline);
      return {
        ok: head.trim() === "DS_PROBE_OK",
        stdout: newline === -1 ? "" : captured.slice(newline + 1),
        stderr: "",
      };
    },
    write: (path, contents, mode) =>
      sshScript(STAGE_1, remoteWriteScript(path, contents, mode), { label: `write ${path}` }),
    // Separate from `write` because it must NOT truncate: the audit trail of
    // `reset main` is the whole point of the file it appends to.
    append: (path, contents, mode) =>
      sshScript(STAGE_1, remoteWriteScript(path, contents, mode, { append: true }), {
        label: `append ${path}`,
      }),
    // The ONE effect that does not go to the box: the shared Zitadel's management API.
    // Built per step, so every command that emits no `idp` step still runs on a box
    // where the bootstrap PAT file is not readable.
    // --- the five remote-only routines ---------------------------------------
    ship: (step) =>
      shipTree(step.sha, STAGE_1, {
        liveDir: step.liveDir,
        preserved: step.preserved,
        tmpPrefix: step.tmpPrefix,
      }),
    verifyImages: async (step) => {
      const { bootProbe } = await readSlotServices(step.slot);
      const out = await sshCapture(
        STAGE_1,
        verifyImagesScript({ slot: step.slot, sha: step.sha, services: bootProbe }),
      );
      console.log(out.split(/\r?\n/).map((line) => `  ${line}`).join("\n"));
      return assertImagesBoot(out, bootProbe);
    },
    verifyRunning: async (step) => {
      const { longRunning } = await readSlotServices(step.slot);
      const out = await sshCapture(
        STAGE_1,
        verifyRunningScript({ slot: step.slot, sha: step.sha, services: longRunning }),
      );
      console.log(`  ${out}`);
      return assertRunningVerdict(out, { slot: step.slot, sha: step.sha });
    },
    // NOT over ssh: the assertion is worth making only through the edge a reviewer
    // uses — Caddy's routing, the wildcard certificate and the stand's basic auth.
    health: async (step) => {
      const user = boxEnv.STAGE_BASIC_AUTH_USER;
      if (!user) {
        throw new SlotError(
          `STAGE_BASIC_AUTH_USER is not in ${STAGE_ENV_FILE} on ${STAGE_1} — the ` +
            "stage provisioning places it there alongside its bcrypt hash",
        );
      }
      const headers = {
        authorization: basicAuthHeader(user, requiredOperatorPassword(process.env)),
        accept: "application/json",
      };
      const deadline = Date.now() + HEALTH_DEADLINE_MS;
      let verdict;
      for (;;) {
        verdict = await probeSlotHealth(step.url, headers, step.sha);
        if (verdict.ok || Date.now() >= deadline) break;
        await delay(HEALTH_POLL_MS);
      }
      if (!verdict.ok) {
        throw new SlotError(`${step.url} is not serving the converged commit: ${verdict.reason}`);
      }
      console.log(`  ↳ ${verdict.reason}`);
      return verdict;
    },
    prune: (step) =>
      sshScript(
        STAGE_1,
        pruneScript({ retention: step.retention, reservedSpace: step.reservedSpace }),
        // Build-class budget: the first prune on a box that has never been GC'd walks
        // the whole snapshotter content store and can go minutes without a line.
        { label: step.label, stallBudgetMs: STALL_BUDGET_BUILD_MS },
      ),
    idp: async (step) => {
      const client = createIdpClient({
        fetch: globalThis.fetch,
        baseUrl: resolveIdpBaseUrl(boxEnv),
        pat: await readIdpPat(),
      });
      const projectName = boxEnv.IDP_PROJECT_NAME || undefined;
      const appName = boxEnv.IDP_APP_NAME || undefined;
      const log = (line) => console.log(line);
      if (step.op === "redirect-uris") {
        await convergeRedirectUris({
          client,
          projectName,
          appName,
          desired: resolveDesiredRedirectSet(step, boxEnv),
          log,
        });
        return undefined;
      }
      if (step.op === "golden-identities") {
        // The BOX env is the password map: the five `DS_GOLDEN_PASSWORD_*` are
        // owner-placed in /etc/ds-platform/stage.env and read by name, never logged.
        return convergeGoldenIdentities({
          client,
          accounts: GOLDEN_IDP_ACCOUNTS,
          passwords: boxEnv,
          env: boxEnv,
          log,
        });
      }
      throw new SlotError(`unknown idp step op: ${step.op}`);
    },
    log: (line) => console.log(line),
  };
}

function requiredBaseDomain(boxEnv) {
  const baseDomain = boxEnv.STAGE_BASE_DOMAIN;
  if (!baseDomain) {
    throw new SlotError(
      `STAGE_BASE_DOMAIN is not in ${STAGE_ENV_FILE} on ${STAGE_1} — the stage ` +
        "provisioning places it there",
    );
  }
  return assertBaseDomain(baseDomain);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const boxEnv = await readBoxEnvFile(STAGE_ENV_FILE);
  const liveSlots = await readLiveSlots();
  const effects = realEffects(boxEnv);

  if (options.command === "status") {
    console.log(`# live slots on ${STAGE_1} (docker compose project labels)`);
    console.log(JSON.stringify(liveSlots, null, 2));
    console.log("# shared IdP redirect set — `up`/`down` converge this onto the app");
    console.log(
      JSON.stringify(
        renderIdpRedirectUris(Object.keys(liveSlots), requiredBaseDomain(boxEnv)),
        null,
        2,
      ),
    );
    return;
  }

  if (options.command === "gc") {
    const images = planUnreferencedImageGc({
      images: await readBoxImages(),
      liveSlots,
    });
    const prune = planPruneByFreeSpace({ freeBytes: await readBoxFreeBytes() });
    await runSlotPlan({ steps: [...images.commands, ...prune.commands] }, effects);
    console.log(
      `gc: ${images.remove.length} unreferenced slot image(s) removed; ` +
        `free disk floor ${GC_FREE_SPACE_FLOOR}`,
    );
    return;
  }

  console.log(
    await runSlotCommand({
      options: { ...options, actor: process.env.SUDO_USER || process.env.USER },
      liveSlots,
      baseDomain: requiredBaseDomain(boxEnv),
      effects,
      // A THUNK: `runSlotCommand` calls it only in the `up`/`sync` branch for `main`.
      databaseExists: () => boxDatabaseExists(slotDatabaseName("main")),
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
