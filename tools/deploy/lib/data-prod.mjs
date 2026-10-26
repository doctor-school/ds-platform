// tools/deploy/lib/data-prod.mjs — the one way a prod run reaches ds-data-prod
// (Issue #3313; tech spec 2026-10-16-release-pipeline-off-workstation-en.md §4, §5
// «Data-prod verbs.»).
//
// ds-data-prod serves only the data verbs of `infra/deploy/bin/ds-deploy-entrypoint`.
// The hop key of the release driver on ds-api-prod sits behind the forced command
// `sudo -n /usr/local/bin/ds-deploy-entrypoint`, so the verb travels as the ssh
// command itself; a login with a shell (`breakglass` on the workstation path, or
// `deploy` before the converge) runs the same verb through `sudo -n`. A payload is
// one JSON object or the tree archive on stdin — never a script.

import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";

import { DS_DEPLOY_ENTRYPOINT_BIN, HARDEN_SSH_BIN, boxSpawnArgs, releaseInstallFromSourceScript, sshScript } from "./remote.mjs";

/** The verbs the entrypoint serves on the data box; pinned equal to its DATA_VERBS. */
export const DATA_VERBS = [
  "capabilities",
  "postgres-probe",
  "postgres-checkpoint",
  "ship",
  "install",
  "data-env",
  "data-up",
  "backup",
  "backup-info",
  "rollback-floor",
  "finish",
  "check",
  "supersede",
  "converge",
];

// The verbs the capabilities probe requires: an entrypoint that predates `converge`
// still serves the run up to its `install`, and the entrypoint that install places
// serves `converge` (#3320).
const PROBE_VERBS = DATA_VERBS.filter((v) => v !== "converge");

// The entrypoint's own COMMAND_RE / COMMAND_MAX: what it admits as a request.
const REQUEST_RE = /^[a-z0-9-]+( [a-z0-9-]+)*$/;
const REQUEST_MAX = 200;

/**
 * The ssh command of one data-prod request. `forced`: the request itself, which the
 * forced command hands the entrypoint as SSH_ORIGINAL_COMMAND. `sudo`: the same
 * request through `sudo -n` from a shell login. The request passed REQUEST_RE, so
 * it holds no quote and no shell metacharacter.
 */
export function dataVerbCommand(request, form) {
  if (request.length > REQUEST_MAX || !REQUEST_RE.test(request)) {
    throw new Error(`not a data-prod request: ${JSON.stringify(request)}`);
  }
  const verb = request.split(" ")[0];
  if (verb !== "status" && !DATA_VERBS.includes(verb)) {
    throw new Error(`ds-data-prod serves no ${verb} verb`);
  }
  if (form === "forced") return request;
  if (form === "sudo") return `sudo -n env SSH_ORIGINAL_COMMAND='${request}' ${DS_DEPLOY_ENTRYPOINT_BIN}`;
  throw new Error(`unknown data-prod command form ${JSON.stringify(form)}`);
}

/** True when `stdout` is the data box's `capabilities` answer naming every verb. */
export function servesDataVerbs(stdout) {
  try {
    const answer = JSON.parse(String(stdout).trim());
    return answer?.role === "data" && PROBE_VERBS.every((v) => answer.verbs?.includes(v));
  } catch {
    return false;
  }
}

/**
 * Run one ssh command on `host`, stdin = `input` (a string/Buffer) or the file
 * `inputFile`. Resolves to stdout; `stream` forwards the box's output live instead.
 * Rejects on a non-zero exit with the first stderr line.
 */
export function runBoxCommand(
  host,
  remoteCommand,
  { input = "", inputFile, stream = false, sshOptions = [], label = "data-prod", spawnImpl = spawn } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(...boxSpawnArgs(host, remoteCommand, sshOptions), {
      stdio: ["pipe", stream ? "inherit" : "pipe", stream ? "inherit" : "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve(out.trim());
      const detail = err.trim().split(/\r?\n/)[0];
      reject(new Error(`${label} on ${host} exited ${code}${detail ? `: ${detail}` : ""}`));
    });
    child.stdin.on("error", () => {}); // a refused request closes stdin early; the exit code tells
    if (inputFile) createReadStream(inputFile).pipe(child.stdin);
    else child.stdin.end(input);
  });
}

/**
 * The data-prod client of one run. The command form is found once, by asking
 * `capabilities` as the forced command, then through `sudo -n`.
 *
 * Transition (spec §5 «Data-prod verbs.» «Transition.»): when neither answers, the
 * hop still has `deploy`'s shell and sudo and the installed entrypoint predates the
 * data verbs — the first release after #3313. The client then installs the box
 * entrypoints from `bootstrapSources()` ([{ source, dest }], the bytes the run
 * holds) through that shell, the checked from-source install of the workstation
 * `--rollback`, and asks again. `harden-ssh.sh --role data` refuses until the
 * installed entrypoint serves the data verbs, so after the converge this branch is
 * never taken; delete it (and `bootstrapSources`) once the converge has run.
 */
export function createDataProdClient({
  host,
  bootstrapSources,
  run = runBoxCommand,
  script = sshScript,
  log = (line) => console.log(line),
}) {
  let form = null;
  let unreachable = null; // set by a converge after which the forced command does not answer
  const ask = async (f) => {
    try {
      return servesDataVerbs(await run(host, dataVerbCommand("capabilities", f), { label: "capabilities" }));
    } catch {
      return false;
    }
  };
  const detect = async () => {
    for (const f of ["forced", "sudo"]) if (await ask(f)) return f;
    return null;
  };
  const client = {
    get host() {
      return host;
    },
    /** The command form, found on first use. */
    async ready() {
      if (unreachable) throw unreachable;
      if (form) return form;
      form = await detect();
      if (form) return form;
      if (!bootstrapSources) throw new Error(`${host} serves no data-prod verbs`);
      log(`  ↻ ${host}: the installed entrypoint predates the data-prod verbs — installing it from this run's tree (#3313 transition)`);
      await script(host, releaseInstallFromSourceScript(bootstrapSources()), {
        label: "install the data-prod verbs",
      });
      form = (await ask("sudo")) ? "sudo" : null;
      if (!form) throw new Error(`${host} still serves no data-prod verbs after the install`);
      return form;
    },
    /** The ssh command of `words`, once the form is known. */
    async command(words) {
      return dataVerbCommand(words.join(" "), await client.ready());
    },
    /** The ssh command of `words` if the form is already known, else null (sync callers). */
    knownCommand(words) {
      return form ? dataVerbCommand(words.join(" "), form) : null;
    },
    /**
     * The release's own converge of ds-data-prod (#3320; spec §5 «Data-prod verbs.»
     * «Converge.»), after the data `install` and before any data-prod state change.
     * The box proves it, every release: the `converge <sha>` verb runs the installed
     * root-owned harden-ssh.sh --role data --from-release (idempotent, `nothing to
     * change` once done) through whichever form answered — the forced command once
     * converged, `sudo -n` before. Which form answers is no proof: a converge that
     * stopped after the hop line went behind the forced command leaves deploy's other
     * rights in place, and only the next run of harden-ssh.sh finishes them. The run
     * goes on only when the verb exited 0 and the forced command answers. Only the hop
     * calls this: a breakglass login answers through `sudo` on a converged box too.
     */
    async converge(sha) {
      const through = await client.ready();
      log(
        `  ↻ ${host}: converge ${sha.slice(0, 12)}: ${HARDEN_SSH_BIN} --role data --from-release, through ${through === "forced" ? "the forced command" : "sudo -n"}`,
      );
      try {
        await client.call(["converge", sha], { stream: true });
      } catch (error) {
        // A converge that failed after the hop rewrite answers only through the
        // forced command now: re-probe, so the run's `finish … failed` still lands.
        form = await detect();
        if (!form) unreachable = new Error(`${host}: no data-prod command form answers after the failed converge`);
        throw error;
      }
      form = await detect();
      if (form !== "forced") {
        unreachable = new Error(`${host}: the forced command does not answer after the converge`);
        form = null;
        throw unreachable;
      }
      log(`  ✓ ${host}: converged: capabilities answers through the forced command`);
    },
    /** Run one verb; `options` as runBoxCommand's. */
    async call(words, options = {}) {
      return run(host, await client.command(words), { label: words[0], ...options });
    },
  };
  return client;
}
