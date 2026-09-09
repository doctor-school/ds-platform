import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Fixed-key counters only: provider messages can contain OTPs and credentials. */
export function summarizeProviderLogs(raw) {
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const count = (pattern) => lines.filter((line) => pattern.test(line)).length;
  return {
    lines: lines.length,
    error: count(/level[=:]"?error\b/i),
    smtp: count(/\bsmtp\b/i),
    notification: count(/\bnotification\b/i),
    projection: count(/\bprojection\b/i),
    connectionRefused: count(/connection refused/i),
    deadlineExceeded: count(/deadline exceeded/i),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const providers = {};
  for (const name of ["ds-idp", "ds-mailpit"]) {
    const result = spawnSync("docker", ["logs", "--tail", "400", name], {
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    providers[name] = {
      available: result.status === 0,
      ...summarizeProviderLogs(
        `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
      ),
    };
  }
  // Never upload raw logs, message bodies/subjects, environment or provisioner output.
  writeFileSync(
    "api-e2e-diagnostics.json",
    JSON.stringify({ providers }, null, 2),
  );
}
