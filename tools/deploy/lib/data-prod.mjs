// tools/deploy/lib/data-prod.mjs — the one way a prod run reaches ds-data-prod
// (Issue #3313; tech spec 2026-10-16-release-pipeline-off-workstation-en.md §4, §5
// «Data-prod verbs.»).
//
// ds-data-prod serves only the data verbs of `infra/deploy/bin/ds-deploy-entrypoint`.
// The hop key of the release driver on ds-api-prod sits behind the forced command
// `sudo -n /usr/local/bin/ds-deploy-entrypoint`, so the verb travels as the ssh
// command itself; the `breakglass` login of the workstation path has a shell and
// runs the same verb through `sudo -n`. A payload is one JSON object or the tree
// archive on stdin — never a script.

import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";

import { DS_DEPLOY_ENTRYPOINT_BIN, HARDEN_SSH_BIN, boxSpawnArgs } from "./remote.mjs";

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
    return answer?.role === "data" && DATA_VERBS.every((v) => answer.verbs?.includes(v));
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
 * The data-prod client of one run, in the one command form its login takes (spec §5
 * «Data-prod verbs.» «Transport.»): `forced` for the hop key of the `--local` run,
 * whose forced command is the only thing it reaches; `sudo` for the `breakglass`
 * shell login of the workstation path. The form is asked `capabilities` once, on
 * first use; a form that does not answer refuses the run — the other form is never
 * tried, so a hop whose forced command stopped answering is not served through sudo.
 */
export function createDataProdClient({ host, form, run = runBoxCommand, log = (line) => console.log(line) }) {
  if (form !== "forced" && form !== "sudo") throw new Error(`unknown data-prod command form ${JSON.stringify(form)}`);
  const through = form === "forced" ? "the forced command" : "sudo -n";
  let answered = false;
  let unreachable = null; // set by a converge after which the forced command does not answer
  const ask = async () => {
    try {
      return servesDataVerbs(await run(host, dataVerbCommand("capabilities", form), { label: "capabilities" }));
    } catch {
      return false;
    }
  };
  const client = {
    get host() {
      return host;
    },
    /** The command form, once `capabilities` answered through it. */
    async ready() {
      if (unreachable) throw unreachable;
      if (answered) return form;
      answered = await ask();
      if (!answered) throw new Error(`${host} serves no data-prod verbs through ${through}`);
      return form;
    },
    /** The ssh command of `words`, once the form answered. */
    async command(words) {
      return dataVerbCommand(words.join(" "), await client.ready());
    },
    /** The ssh command of `words` if the form already answered, else null (sync callers). */
    knownCommand(words) {
      return answered ? dataVerbCommand(words.join(" "), form) : null;
    },
    /**
     * The release's own converge of ds-data-prod (#3320; spec §5 «Data-prod verbs.»
     * «Converge.»), after the data `install` and before any data-prod state change,
     * through the hop's forced command only. The box proves it, every release: the
     * `converge <sha>` verb runs the installed root-owned harden-ssh.sh --role data
     * --from-release (idempotent, `nothing to change` once done). The forced command
     * answering is no proof: a converge that stopped after the hop line went behind it
     * leaves deploy's other rights in place, and only the next run of harden-ssh.sh
     * finishes them. The run goes on only when the verb exited 0 and the forced command
     * still answers.
     */
    async converge(sha) {
      if (form !== "forced") throw new Error(`${host}: only the hop's forced command converges ds-data-prod`);
      await client.ready();
      log(`  ↻ ${host}: converge ${sha.slice(0, 12)}: ${HARDEN_SSH_BIN} --role data --from-release, through ${through}`);
      try {
        await client.call(["converge", sha], { stream: true });
      } catch (error) {
        // Re-probe, so the run's `finish … failed` still lands when the box answers.
        answered = await ask();
        if (!answered) unreachable = new Error(`${host}: the forced command does not answer after the failed converge`);
        throw error;
      }
      answered = await ask();
      if (!answered) {
        unreachable = new Error(`${host}: the forced command does not answer after the converge`);
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
