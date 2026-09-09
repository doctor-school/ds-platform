#!/usr/bin/env node
// Build and exercise isolated immutable PostgreSQL artifacts, never start a cluster.
import { spawnSync } from "node:child_process";
import { appendFileSync, writeFileSync, openSync, closeSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DATA_PATH,
  SOURCE_LABEL,
  readPostgresTarget,
} from "./postgres-guard.mjs";

export function artifactBuildPlan({ sourceHash, target, task = "2141" }) {
  if (!/^[a-f0-9]{64}$/.test(sourceHash) || !/^\d+$/.test(task))
    throw new Error("Invalid artifact identity");
  return ["postgres", "pgbackrest"].map((role) => ({
    role,
    tag: `ds-pg-artifact-${task}-${role}:${sourceHash.slice(0, 16)}`,
    labels: [`org.doctor-school.task=${task}`, `${SOURCE_LABEL}=${sourceHash}`],
    context: `${DATA_PATH}${role}`,
    major: target.major,
    pgdata: target.pgdata,
  }));
}

export function certifyImage({
  inspected,
  versionOutput,
  uidOutput,
  plan,
  sourceHash,
}) {
  const env = Object.fromEntries(
    inspected.Config.Env.map((v) => v.split(/=(.*)/s).slice(0, 2)),
  );
  const version = versionOutput.match(/\(PostgreSQL\) (\d+\.\d+(?:\.\d+)?)/);
  if (
    !version ||
    Number(version[1].split(".")[0]) !== plan.major ||
    Number(env.PG_MAJOR) !== plan.major ||
    env.PGDATA !== plan.pgdata ||
    inspected.Config.Labels?.[SOURCE_LABEL] !== sourceHash ||
    !/^sha256:[a-f0-9]{64}$/.test(inspected.Id) ||
    !/^\d+$/.test(uidOutput.trim())
  )
    throw new Error(
      "Built artifact did not satisfy major, PGDATA, UID or source provenance",
    );
  return {
    id: inspected.Id,
    major: plan.major,
    pgdata: env.PGDATA,
    version: `PostgreSQL ${version[1]}`,
    uid: Number(uidOutput.trim()),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name) => args[args.indexOf(name) + 1];
  for (const name of [
    "--host",
    "--ref",
    "--output",
    "--audit-log",
    "--export",
  ]) {
    if (!args.includes(name) || !option(name) || option(name).startsWith("--"))
      throw new Error(`Required ${name} <value>`);
  }
  if (args.length !== 10) throw new Error("Unknown/duplicate arguments");
  const host = option("--host");
  if (!/^[\w.-]+$/.test(host))
    throw new Error("Use a configured SSH host alias");
  const ref = option("--ref");
  const target = readPostgresTarget(ref);
  const { sshBaseArgs } = await import("./prod.mjs");
  const sshArgs = [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    ...sshBaseArgs(host),
  ];
  const remote = (command, { input, binaryOutput } = {}) => {
    appendFileSync(
      option("--audit-log"),
      JSON.stringify({
        at: new Date().toISOString(),
        executable: "ssh",
        args: [...sshArgs, command],
        input: input ? "committed infra build context tar" : null,
      }) + "\n",
    );
    const r = spawnSync("ssh", [...sshArgs, command], {
      input,
      encoding: binaryOutput ? undefined : "utf8",
      stdio: binaryOutput ? ["pipe", binaryOutput, "pipe"] : undefined,
      maxBuffer: 32 * 1024 * 1024,
      timeout: 15 * 60 * 1000,
    });
    if (r.status !== 0)
      throw new Error(
        `Artifact command failed (${r.status}): ${String(r.stderr || r.error || "").slice(-4000)}`,
      );
    return String(r.stdout || "").trim();
  };
  // Mandatory read-only resource/capacity evidence before any build.
  console.log(
    remote(
      "df -Pk /mnt; sudo docker system df; sudo docker ps -a --filter label=org.doctor-school.task=2141 --format '{{.Names}} {{.Status}}'",
    ),
  );
  const certificate = { schema: 1, sourceHash: target.sourceHash, images: {} };
  const plans = artifactBuildPlan(target);
  for (const plan of plans) {
    const archive = spawnSync(
      "git",
      ["archive", "--format=tar", `${target.sha}:${plan.context}`],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    if (archive.status !== 0)
      throw new Error("Cannot archive committed infra build context");
    remote(
      `sudo docker build ${plan.labels.map((l) => `--label ${l}`).join(" ")} --tag ${plan.tag} -`,
      { input: archive.stdout },
    );
    const inspected = JSON.parse(
      remote(`sudo docker image inspect ${plan.tag}`),
    )[0];
    const prefix = `sudo docker run --rm --network none --read-only --label org.doctor-school.task=2141`;
    const versionOutput = remote(
      `${prefix} --entrypoint postgres ${plan.tag} --version`,
    );
    const uidOutput = remote(
      `${prefix} --entrypoint id ${plan.tag} -u postgres`,
    );
    certificate.images[plan.role] = certifyImage({
      inspected,
      versionOutput,
      uidOutput,
      plan,
      sourceHash: target.sourceHash,
    });
  }
  if (certificate.images.postgres.uid !== certificate.images.pgbackrest.uid)
    throw new Error("Server/sidecar UID mismatch");
  const output = openSync(option("--export"), "wx");
  try {
    remote(`sudo docker image save ${plans.map((p) => p.tag).join(" ")}`, {
      binaryOutput: output,
    });
  } finally {
    closeSync(output);
  }
  writeFileSync(
    option("--output"),
    JSON.stringify(certificate, null, 2) + "\n",
    { flag: "wx" },
  );
  console.log(
    `Certified PG${target.target.major} artifacts exported. No cluster was initialized; images remain labelled task2141 on ${host}.`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
