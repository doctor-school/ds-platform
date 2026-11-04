#!/usr/bin/env node
// tools/deploy/prod-read.mjs — the prod read path's commands (Issue #3646; spec
// apps/docs/content/specs/tech/2026-10-16-release-pipeline-off-workstation-en.md §5
// «Prod read verbs.» → «Workflow `prod-observe.yml`.», «Local commands.»; §10).
//
// Operator (workstation):
//   pnpm prod:read <run-id>               download + decrypt one run's artifact
//   pnpm prod:schema-drift <run-id>       drift of a `schema` answer vs the tree (exit 0 / 1 drift / 2 usage)
//   pnpm prod:read-key                    the owner's step: the read ssh key pair
//   pnpm prod:read-result-key [--rotate]  the lead's step: the result key pair
// Runner (prod-observe.yml, node builtins only):
//   node tools/deploy/prod-read.mjs check-inputs <stdin-file>       env VERB NAME PARAMS SHA
//   node tools/deploy/prod-read.mjs check-capabilities <verb>       stdin the capabilities answer
//   node tools/deploy/prod-read.mjs status <verb> <rc> <cms> <stderr>

import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  answerOf,
  checkCapabilities,
  checkInputs,
  readKey,
  ReadError,
  readRun,
  resultKey,
  statusLine,
} from "./lib/prod-read.mjs";
import {
  catalogueDrift,
  migrationDrift,
  newestSnapshot,
} from "./lib/schema-drift.mjs";

const repoRoot = () =>
  execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
const home = () => process.env.DS_PROD_READ_HOME || homedir();

function output(key, value) {
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

/** `schema-drift`: (a) migrations and (b) catalogue of a decrypted `schema` answer. */
export function schemaDrift({ answer, root }) {
  if (answer?.verb !== "schema")
    throw new ReadError("the answer is not a schema answer");
  const meta = join(root, "apps/api/drizzle/meta");
  const journal = JSON.parse(readFileSync(join(meta, "_journal.json"), "utf8"));
  const name = newestSnapshot(readdirSync(meta));
  if (!name) throw new ReadError(`no *_snapshot.json in ${meta}`);
  const snapshot = JSON.parse(readFileSync(join(meta, name), "utf8"));
  const readSql = (tag) => {
    const p = join(root, "apps/api/drizzle", `${tag}.sql`);
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  };
  return {
    snapshot: name,
    migrations: migrationDrift(journal, readSql, answer.migrations),
    catalogue: catalogueDrift(snapshot, answer.catalogue),
  };
}

function main(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "read": {
      if (rest.length !== 1)
        throw new ReadError("usage: pnpm prod:read <run-id>");
      const { path, answer } = readRun({
        runId: rest[0],
        home: home(),
        repoRoot: repoRoot(),
      });
      console.log(
        `prod:read: ${answer.verb ?? "answer"} of run ${rest[0]} decrypted to ${path}`,
      );
      return 0;
    }
    case "schema-drift": {
      if (rest.length !== 1)
        throw new ReadError("usage: pnpm prod:schema-drift <run-id>");
      const root = repoRoot();
      const { path, answer } = answerOf({
        runId: rest[0],
        home: home(),
        repoRoot: root,
      });
      const d = schemaDrift({ answer, root });
      const lines = [...d.migrations, ...d.catalogue];
      console.log(
        `prod:schema-drift: ${path} (taken ${answer.takenAt ?? "?"}) against ${d.snapshot} and the journal`,
      );
      for (const l of lines) console.log(`  ${l}`);
      console.log(
        lines.length === 0
          ? "prod:schema-drift: no drift"
          : `prod:schema-drift: ${lines.length} drift line(s)`,
      );
      return lines.length === 0 ? 0 : 1;
    }
    case "read-key": {
      if (rest.length !== 0) throw new ReadError("usage: pnpm prod:read-key");
      const { pubkeyPath } = readKey({ repoRoot: repoRoot() });
      console.log(
        `prod:read-key: PROD_READ_SSH_KEY set in Environment production-read; public half at ${pubkeyPath}`,
      );
      console.log(
        "prod:read-key: open a PR with that file; the next prod release installs the read line",
      );
      return 0;
    }
    case "result-key": {
      const rotate = rest.length === 1 && rest[0] === "--rotate";
      if (rest.length > 1 || (rest.length === 1 && !rotate))
        throw new ReadError("usage: pnpm prod:read-result-key [--rotate]");
      const { keyPath, certPath, fingerprint } = resultKey({
        repoRoot: repoRoot(),
        home: home(),
        rotate,
      });
      console.log(
        `prod:read-result-key: private key ${keyPath} (0600), certificate ${certPath}`,
      );
      console.log(`prod:read-result-key: certificate SHA-256 ${fingerprint}`);
      return 0;
    }
    case "check-inputs": {
      const env = process.env;
      const r = checkInputs({
        verb: env.VERB ?? "",
        name: env.NAME ?? "",
        params: env.PARAMS ?? "",
        sha: env.SHA ?? "",
      });
      if (!r.ok) {
        console.log(`::error::prod-observe: bad inputs: ${r.error}`);
        return 2;
      }
      if (rest[0]) writeFileSync(rest[0], r.stdin ?? "");
      output("command", r.command);
      console.log(`prod-observe: inputs ok: ${r.command.split(" ")[0]}`);
      return 0;
    }
    case "check-capabilities": {
      const r = checkCapabilities(readFileSync(0, "utf8"), rest[0]);
      if (!r.ok) {
        console.log(`::error::prod-observe: ${r.error}`);
        return 1;
      }
      console.log(`prod-observe: capabilities names ${rest[0]}`);
      return 0;
    }
    case "status": {
      const [verb, rc, cmsFile, stderrFile] = rest;
      const cms = existsSync(cmsFile) ? readFileSync(cmsFile) : null;
      const stderr = existsSync(stderrFile)
        ? readFileSync(stderrFile, "utf8")
        : "";
      const { upload, line } = statusLine({
        verb,
        rc: Number(rc),
        cms,
        stderr,
      });
      console.log(upload ? line : `::error::${line}`);
      if (process.env.GITHUB_STEP_SUMMARY)
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
      output("upload", String(upload));
      return upload ? 0 : 1;
    }
    default:
      throw new ReadError(
        "usage: prod-read.mjs read|schema-drift|read-key|result-key|check-inputs|check-capabilities|status",
      );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    const usage = e instanceof ReadError && /^usage:/.test(e.message);
    console.error(`prod-read: ${e.message}`);
    process.exitCode = usage || process.argv[2] === "schema-drift" ? 2 : 1;
  }
}
