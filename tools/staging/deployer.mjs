#!/usr/bin/env node
// tools/staging/deployer.mjs — the pull-based slot deployer of `stage-1` (Issue
// #2064 part 2a, staging tech spec 2026-09-08 §5 «Converge» / §8 step 4).
//
// The box runs no CI agent and holds no write credential. Nothing outside it may
// push work in: this file is the ONLY thing that decides which slots exist, and it
// decides by READING — the open non-draft pull requests of this repository plus the
// `main` head (or a pinned ref), over the public REST API with a read-only token
// whose sole purpose is lifting the anonymous rate limit. Everything is outbound:
// no inbound port, no deploy key, no repository secret on this machine (spec §5
// «Deployer trust boundary»).
//
// Division of labour with `slot.mjs`. This module owns ORCHESTRATION only — what the
// desired set is, which slots that makes `up`, `sync`, `down` or `skip`, and in what
// order. It never touches Postgres, Docker, Caddy or the registry file: each converge
// is a child `ds-slot <action> <slot> [sha]`, so the plan a human runs by hand and the
// plan the timer runs sixty seconds later are the same plan, byte for byte.
//
// Style is `slot.mjs`'s and `golden-db.mjs`'s: pure planners, one injected executor,
// a thin CLI behind `invokedDirectly`. Every decision below is an exported pure
// function with a unit test, which is what makes box behaviour testable on a machine
// with neither Docker nor network.

import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  FULL_SHA_RE,
  GHCR_REPO,
  PREVIEW_SLOT_CAP,
  SLOT_IMAGE_APPS,
  SlotError,
  assertSlotName,
  readRegistry,
  shortSha,
} from "./slot.mjs";

// --- constants ---------------------------------------------------------------

/** The repository whose open PRs are the desired preview set. */
export const REPO = "doctor-school/ds-platform";

/** GitHub REST, version-pinned like every other call in this repo's tooling. */
export const GITHUB_API = "https://api.github.com";
export const GITHUB_API_VERSION = "2022-11-28";

/**
 * The pinned-`main` file, written by steps 5/6 (#2065/#2066) and only READ here.
 *
 * The regression contour needs a `main` slot that stays on ONE commit while a suite
 * runs against it, so a run is not silently re-based mid-flight by an unrelated
 * merge. When the file is present and valid it WINS over the live `main` head; when
 * it is absent the deployer tracks the head. It is deliberately not created in this
 * part — this part only has to honour it.
 */
export const PIN_PATH = "/var/lib/ds-platform/main-pin.json";

/** The wrapper the install script lands: it sources `stage.env` and execs `slot.mjs`. */
export const SLOT_CLI = "/usr/local/bin/ds-slot";

/**
 * Manifest media types a tag probe will accept.
 *
 * All three, because what a tag points at depends on how it was built: a multi-
 * platform `docker buildx` publishes an OCI index, a single-platform build publishes
 * a plain manifest, and older tooling publishes a Docker v2 list. Sending only one of
 * them turns an existing tag into a 404, and the deployer would then skip a slot
 * whose images are right there.
 */
export const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
].join(", ");

// --- desired state -----------------------------------------------------------

/**
 * Parses the pinned-`main` file.
 *
 * Fails CLOSED and loudly, naming the path: a pin exists precisely because someone
 * needs `main` held still, so a malformed one must stop the tick rather than quietly
 * fall through to the live head and move the very slot the pin was protecting.
 */
export function parsePin(text, path = PIN_PATH) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SlotError(
      `${path} is not valid JSON — refusing to fall back to the \`main\` head`,
    );
  }
  const sha = parsed?.sha;
  if (!FULL_SHA_RE.test(String(sha ?? ""))) {
    throw new SlotError(
      `${path} does not hold a full commit SHA (got ${JSON.stringify(sha)}) — ` +
        "refusing to fall back to the `main` head",
    );
  }
  return { sha, pinnedAt: parsed?.pinnedAt };
}

/**
 * The desired slot set: `main` plus one preview per open, non-draft, same-repo PR.
 *
 * Three exclusions, each load-bearing rather than tidy:
 *
 * - a **draft** PR is work in progress its author has not offered for review; it gets
 *   no box RAM, and moving a PR back to draft is the documented way to hand a preview
 *   slot back (§3 «Slots»);
 * - a **fork** PR's `GITHUB_TOKEN` is read-only and cannot push to GHCR, so its images
 *   can never exist. Skipping it here restates the trust boundary rather than adding a
 *   second policy: only images built from a branch OF this repository ever run on the
 *   box (§5 «Deployer trust boundary»);
 * - a **pin**, when present, replaces the live `main` head.
 *
 * ORDER IS PART OF THE RESULT. `main` first, then previews by `updated_at`
 * DESCENDING, because that is the order `capDesired` fills the last free seat in.
 */
export function desiredSlots({ pulls = [], mainHeadSha, pin } = {}) {
  const mainSha = pin?.sha ?? mainHeadSha;
  if (!FULL_SHA_RE.test(String(mainSha ?? ""))) {
    throw new SlotError(
      `unusable \`main\` commit: ${JSON.stringify(mainSha)} — expected a full 40-hex SHA`,
    );
  }
  const previews = pulls
    .filter((pull) => pull?.draft === false)
    .filter((pull) => pull?.head?.repo?.full_name === REPO)
    .filter((pull) => FULL_SHA_RE.test(String(pull?.head?.sha ?? "")))
    .map((pull) => ({
      slot: `pr-${pull.number}`,
      sha: pull.head.sha,
      updatedAt: pull.updated_at ?? "",
    }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));

  const desired = { main: mainSha };
  for (const preview of previews) {
    assertSlotName(preview.slot);
    desired[preview.slot] = preview.sha;
  }
  return desired;
}

/**
 * Trims the desired previews to the box's RAM budget (`PREVIEW_SLOT_CAP`).
 *
 * Under pressure the tie-break is INCUMBENCY, not recency: a preview that is already
 * registered stays, however old it is. Ranking purely by `updated_at` would let a
 * burst of activity on other PRs evict a live slot someone is looking at right now,
 * and every eviction costs a full re-clone + migrate + seed to undo. Free capacity —
 * if any is left — goes to the most recently updated waiting PR, and the rest are
 * reported as `waiting`, never silently dropped.
 *
 * Incumbents are kept even when they alone exceed the cap: they are already running,
 * so downing one buys the box nothing it does not already have.
 */
export function capDesired(desired, registry, cap = PREVIEW_SLOT_CAP) {
  const live = registry?.slots ?? {};
  const previews = Object.keys(desired).filter((slot) => slot !== "main");
  const incumbents = previews.filter((slot) => live[slot]);
  const newcomers = previews.filter((slot) => !live[slot]);
  const free = Math.max(0, cap - incumbents.length);
  const admitted = new Set([...incumbents, ...newcomers.slice(0, free)]);

  const capped = { main: desired.main };
  const waiting = [];
  for (const slot of previews) {
    if (admitted.has(slot)) capped[slot] = desired[slot];
    else waiting.push(slot);
  }
  return { desired: capped, waiting };
}

// --- the tick plan -----------------------------------------------------------

/**
 * The ordered converge list for one tick.
 *
 * DOWNS COME FIRST, and that ordering is the whole reason this is a plan rather than
 * a loop: a closed PR's slot must release its RAM, its Redis database and its cap
 * seat before a newly opened PR tries to take one, or the first tick after a busy
 * merge would refuse the newcomer and only admit it sixty seconds later.
 *
 * Two things are never done, both from §9:
 *
 * - **`main` is never `down`ed.** It is not derived from a PR, so «not in the desired
 *   set» can never be true of it, and a bug that made it true must not be able to tear
 *   down the staging copy of production;
 * - **a slot whose images are not published is skipped, not torn down.** Missing tags
 *   mean the preview build has not finished (or was never dispatched); downing the
 *   previous, working slot on that news would turn a slow build into an outage of a
 *   preview someone is reading.
 */
export function planTick({ desired, registry, tagsPresent = () => true }) {
  const live = registry?.slots ?? {};
  const entries = [];

  for (const slot of Object.keys(live)) {
    if (slot === "main") continue;
    if (Object.prototype.hasOwnProperty.call(desired, slot)) continue;
    entries.push({
      slot,
      action: "down",
      sha: live[slot]?.sha,
      reason: "no open non-draft pull request",
    });
  }

  for (const [slot, sha] of Object.entries(desired)) {
    const verdict = tagsPresent(slot, sha);
    if (verdict !== true) {
      entries.push({
        slot,
        action: "skip",
        sha,
        reason: typeof verdict === "string" ? verdict : "images not published",
      });
      continue;
    }
    const current = live[slot]?.sha;
    if (!current) entries.push({ slot, action: "up", sha, reason: "not registered" });
    else if (current !== sha)
      entries.push({
        slot,
        action: "sync",
        sha,
        reason: `head moved from ${shortSha(current)}`,
      });
    else entries.push({ slot, action: "skip", sha, reason: `already on ${shortSha(sha)}` });
  }

  return entries;
}

/** The child command one plan entry becomes. `down` carries no SHA — see `slot.mjs`. */
export function slotCommandArgv(entry, cli = SLOT_CLI) {
  if (entry.action === "down") return [cli, "down", entry.slot];
  if (entry.action === "up" || entry.action === "sync")
    return [cli, entry.action, entry.slot, entry.sha];
  throw new SlotError(`\`${entry.action}\` is not a converge action`);
}

// --- GHCR tag probe ----------------------------------------------------------

/** `ghcr.io/doctor-school/ds-platform` → `doctor-school/ds-platform`, derived once. */
const GHCR_PATH = GHCR_REPO.replace(/^ghcr\.io\//, "");

/**
 * The two requests per image a tag probe is, as DATA.
 *
 * ANONYMOUS on purpose. GHCR issues a pull token for a public package to anyone who
 * asks, and the box's only GitHub credential is a fine-grained PAT, which GHCR does
 * not accept at all — sending it would turn every probe into a 401 and every slot
 * into «images not published». So the probe asks for a scoped pull token and then
 * asks for the manifest with it: exactly what `docker pull` does, minus the pull.
 */
export function ghcrTagProbePlan(slot, sha) {
  assertSlotName(slot);
  const tag = `${slot}-${shortSha(sha)}`;
  return SLOT_IMAGE_APPS.map((app) => ({
    app,
    tag,
    token: {
      method: "GET",
      url: `https://ghcr.io/token?service=ghcr.io&scope=repository:${GHCR_PATH}/${app}:pull`,
      headers: { Accept: "application/json" },
    },
    manifest: {
      method: "HEAD",
      url: `https://ghcr.io/v2/${GHCR_PATH}/${app}/manifests/${tag}`,
      headers: { Accept: MANIFEST_ACCEPT },
    },
  }));
}

/**
 * Reads the probe results: present only when EVERY image answered 200.
 *
 * Everything else is «absent», never fatal, and that asymmetry is deliberate. The
 * package namespace does not exist until the first push, so a fresh box legitimately
 * sees 404 — or a 401 from the token endpoint, which is how a registry says «no such
 * package» before it can say «no such tag» — for every image, on every tick, for as
 * long as nobody has dispatched a preview build. Treating that as an error would make
 * the unit red forever on a perfectly healthy box. A network failure is likewise
 * absent-with-a-reason: the next tick is sixty seconds away and it will ask again.
 */
export function tagsPresentFromResponses(results) {
  const missing = [];
  for (const result of results) {
    if (result?.error) missing.push(`${result.app}: ${result.error}`);
    else if (result?.status !== 200) missing.push(`${result.app}: HTTP ${result.status}`);
  }
  return missing.length
    ? { present: false, reason: `images not published (${missing.join("; ")})` }
    : { present: true, reason: "" };
}

// --- the executor ------------------------------------------------------------

/**
 * Runs a tick plan through an injected executor.
 *
 * EVERY entry runs, and a failure does not stop the ones after it: the slots are
 * independent, and one PR whose migrate blew up must not hold four other previews
 * hostage until someone notices. The failures are collected and returned so the CLI
 * can exit non-zero with the journal naming every slot and action that failed (§9).
 */
export async function runTick(plan, { exec, log = () => {} }) {
  const failures = [];
  for (const entry of plan) {
    if (entry.action === "skip") {
      log(`skip ${entry.slot}: ${entry.reason}`);
      continue;
    }
    const argv = slotCommandArgv(entry);
    const on = entry.sha ? ` ${shortSha(entry.sha)}` : "";
    log(`${entry.action} ${entry.slot}${on}: ${entry.reason}`);
    try {
      await exec(argv, entry);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ slot: entry.slot, action: entry.action, message });
      log(`FAILED ${entry.action} ${entry.slot}: ${message}`);
    }
  }
  return { failures };
}

// --- CLI ---------------------------------------------------------------------

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command !== "tick") throw new SlotError("usage: ds-slot-deployer tick");
  if (rest.length) throw new SlotError("`tick` takes no arguments");
  return { command };
}

function githubHeaders(token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    "User-Agent": "ds-slot-deployer",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function githubJson(path, token) {
  const response = await fetch(`${GITHUB_API}${path}`, { headers: githubHeaders(token) });
  if (!response.ok) {
    throw new SlotError(`GET ${path} → HTTP ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function readPin() {
  let text;
  try {
    text = readFileSync(PIN_PATH, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return undefined;
    throw err;
  }
  return parsePin(text, PIN_PATH);
}

async function probeTags(slot, sha) {
  const results = [];
  for (const image of ghcrTagProbePlan(slot, sha)) {
    try {
      const tokenResponse = await fetch(image.token.url, { headers: image.token.headers });
      if (!tokenResponse.ok) {
        results.push({ app: image.app, status: tokenResponse.status });
        continue;
      }
      const { token } = await tokenResponse.json();
      const manifest = await fetch(image.manifest.url, {
        method: image.manifest.method,
        headers: { ...image.manifest.headers, Authorization: `Bearer ${token}` },
      });
      results.push({ app: image.app, status: manifest.status });
    } catch (err) {
      results.push({ app: image.app, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return tagsPresentFromResponses(results);
}

async function main() {
  parseArgs(process.argv.slice(2));
  const token = process.env.STAGE_GH_READ_TOKEN;
  const registry = readRegistry();
  const pin = readPin();

  const [pulls, mainCommit] = await Promise.all([
    githubJson(`/repos/${REPO}/pulls?state=open&per_page=100`, token),
    githubJson(`/repos/${REPO}/commits/main`, token),
  ]);

  const all = desiredSlots({ pulls, mainHeadSha: mainCommit?.sha, pin });
  const { desired, waiting } = capDesired(all, registry);
  if (pin) console.log(`main is pinned to ${shortSha(pin.sha)} (${PIN_PATH})`);
  for (const slot of waiting) console.log(`waiting for capacity: ${slot}`);

  const verdicts = new Map();
  for (const [slot, sha] of Object.entries(desired)) {
    const verdict = await probeTags(slot, sha);
    verdicts.set(slot, verdict.present ? true : verdict.reason);
  }

  const plan = planTick({ desired, registry, tagsPresent: (slot) => verdicts.get(slot) });
  const { failures } = await runTick(plan, {
    log: (line) => console.log(line),
    exec: (argv) => {
      const result = spawnSync(argv[0], argv.slice(1), { stdio: "inherit" });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`${argv.join(" ")} exited ${result.status}`);
    },
  });

  if (failures.length) {
    for (const failure of failures) {
      console.error(`tick failed on ${failure.slot} (${failure.action}): ${failure.message}`);
    }
    process.exitCode = 1;
  }
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
