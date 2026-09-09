#!/usr/bin/env node
// Read-only validation. No deployment pipeline, Docker run/build, writes or callbacks.
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { preparePostgresDeployment, sshBaseArgs } from "./prod.mjs";

const args = process.argv.slice(2);
const value = (name) => args[args.indexOf(name) + 1];
try {
  if (
    !args.includes("--ref") ||
    !args.includes("--audit-log") ||
    !value("--ref") ||
    !value("--audit-log")
  )
    throw new Error(
      "Required --ref <commit> --audit-log <file> [--certificate <file>]",
    );
  const certificate = args.includes("--certificate")
    ? JSON.parse(readFileSync(value("--certificate"), "utf8"))
    : undefined;
  const capture = async (host, script) => {
    const command =
      'script=$(cat); exec bash --norc -euo pipefail -c "$script"';
    const sshArgs = [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      ...sshBaseArgs(host),
      command,
    ];
    appendFileSync(
      value("--audit-log"),
      JSON.stringify({
        at: new Date().toISOString(),
        executable: "ssh",
        args: sshArgs,
        stdin: script,
      }) + "\n",
    );
    const result = spawnSync("ssh", sshArgs, {
      input: script,
      encoding: "utf8",
      timeout: 120000,
      maxBuffer: 1024 * 1024,
    });
    if (result.status !== 0)
      throw new Error(
        `Read-only PostgreSQL probe failed (${result.status}): ${result.stderr || result.error}`,
      );
    return result.stdout;
  };
  const result = await preparePostgresDeployment(value("--ref"), {
    capture,
    certificate,
  });
  console.log(JSON.stringify({ verdict: "PASS", ...result.identity }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
