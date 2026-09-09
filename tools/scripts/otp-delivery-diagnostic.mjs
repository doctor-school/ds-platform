import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// A second allowlist at the artifact boundary protects against future fixture
// changes accidentally copying provider payloads into this public artifact.
function records(value) {
  return (Array.isArray(value) ? value : []).slice(0, 100).map((raw) => {
    const source = raw && typeof raw === "object" ? raw : {};
    const safe = {};
    for (const key of [
      "status",
      "messageStatus",
      "messages",
      "fresh",
      "subjectMatches",
      "eligible",
      "userMatches",
    ]) {
      if (
        Number.isInteger(source[key]) &&
        source[key] >= 0 &&
        source[key] <= 100_000
      )
        safe[key] = source[key];
    }
    if (Number.isInteger(source.code) && source.code >= 0 && source.code <= 16)
      safe.code = source.code;
    for (const key of [
      "sessionPresent",
      "sessionTokenPresent",
      "codeExtracted",
    ])
      if (typeof source[key] === "boolean") safe[key] = source[key];
    if (
      [
        "sessions",
        "user-search",
        "email-factor",
        "sms-factor",
        "other",
      ].includes(source.route)
    )
      safe.route = source.route;
    if (["POST", "GET", "other"].includes(source.method))
      safe.method = source.method;
    return safe;
  });
}

export function sanitizeCase(value = {}) {
  return {
    passed: value.passed === true,
    cleanup: value.cleanup === true,
    provider: records(value.provider),
    attempts: (Array.isArray(value.attempts) ? value.attempts : [])
      .slice(0, 3)
      .map((attempt) => ({
        provider: records(attempt?.provider),
        mailbox: records(attempt?.mailbox),
      })),
  };
}

export async function runDiagnostic(execute, persist = () => {}) {
  const result = { success: false, cases: [] };
  persist(result);
  for (let index = 1; index <= 20; index++) {
    let raw;
    try {
      raw = await execute(index);
    } catch {
      // Process startup errors can embed arguments/environment. Retain only
      // the failed-case outcome; never print arbitrary exception messages.
      raw = { exitCode: 1 };
    }
    const evidence = {
      index,
      exitCode: Number.isInteger(raw.exitCode) ? raw.exitCode : 1,
      ...sanitizeCase(raw),
    };
    result.cases.push(evidence);
    persist(result);
    if (evidence.exitCode !== 0 || !evidence.passed || !evidence.cleanup)
      return result;
  }
  result.success = true;
  persist(result);
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const output = resolve(root, "otp-delivery-diagnostic.json");
  const persist = (result) =>
    writeFileSync(output, JSON.stringify(result, null, 2));
  // This driver operates ONLY on the isolated CI services provisioned by ci.yml.
  // Fail closed before any test, rather than silently skip on missing OIDC env.
  const required = [
    "DATABASE_URL",
    "IDP_ISSUER",
    "IDP_CLIENT_ID",
    "IDP_SERVICE_TOKEN",
    "IDP_REDIRECT_URI",
    "MAILPIT_URL",
  ];
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    required.some((key) => !process.env[key])
  ) {
    persist({ success: false, cases: [], configurationMissing: true });
    console.error(
      "OTP diagnostic requires the provisioned GitHub Actions API job",
    );
    process.exitCode = 1;
  } else {
    const scratch = mkdtempSync(join(tmpdir(), "otp-diagnostic-"));
    const result = await runDiagnostic(async (index) => {
      const evidencePath = join(scratch, `case-${index}.json`);
      // Each fresh Vitest process runs exactly the existing EARS-6 case; it
      // retains the original 45s test / 15s mailbox deadlines and afterAll.
      // Capture (never print/upload) assertion/provider output: it may contain
      // tokens on an unrelated assertion failure. Only the allowlist survives.
      const child = spawnSync(
        "pnpm",
        [
          "--filter",
          "@ds/api",
          "test",
          "test/auth/zitadel-otp-login.e2e-spec.ts",
          "--testNamePattern=EARS-6:",
          "--bail=1",
        ],
        {
          cwd: root,
          env: { ...process.env, OTP_DIAGNOSTIC_CASE_FILE: evidencePath },
          encoding: "utf8",
          stdio: "pipe",
          maxBuffer: 2 * 1024 * 1024,
          // Includes process startup/migration and teardown, not a test extension.
          timeout: 120_000,
          shell: process.platform === "win32",
        },
      );
      let evidence = {};
      try {
        evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
      } catch {
        /* Missing evidence fails closed. */
      }
      console.log(
        `OTP diagnostic case ${index}: process ${child.status === 0 ? "completed" : "failed"}`,
      );
      return { ...evidence, exitCode: child.status ?? 1 };
    }, persist);
    process.exitCode = result.success ? 0 : 1;
  }
}
