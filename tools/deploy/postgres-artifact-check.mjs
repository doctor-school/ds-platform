#!/usr/bin/env node
// Read-only validation. No deployment pipeline, Docker run/build, writes or callbacks.
import { appendFileSync, readFileSync } from "node:fs";
import { createDataProdClient, runBoxCommand } from "./lib/data-prod.mjs";
import { sshBaseArgs } from "./lib/remote.mjs";
import { preparePostgresDeployment } from "./prod.mjs";

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
  // #3313: the check reaches ds-data-prod the one way a release does — its
  // `postgres-probe` verb (spec §5 «Data-prod verbs.»), never a shell script.
  const sshOptions = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"];
  const run = (host, remoteCommand, options = {}) => {
    appendFileSync(
      value("--audit-log"),
      JSON.stringify({
        at: new Date().toISOString(),
        executable: "ssh",
        args: [...sshBaseArgs(host, sshOptions), remoteCommand],
        stdin: options.input ?? "",
      }) + "\n",
    );
    return runBoxCommand(host, remoteCommand, { ...options, sshOptions });
  };
  const client = createDataProdClient({
    host: process.env.DS_DATA_PROD_SSH || "ds-data-prod",
    form: "sudo",
    run,
  });
  const result = await preparePostgresDeployment(value("--ref"), {
    client,
    certificate,
  });
  console.log(JSON.stringify({ verdict: "PASS", ...result.identity }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
