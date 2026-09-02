import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/ci/assert-no-skipped-e2e.ts` (#1595).
 *
 * The `api-e2e` CI job used to run with only `DATABASE_URL` in its environment,
 * so every `describe.skipIf(… || !process.env.IDP_ISSUER)` suite skipped and the
 * check-run went green having executed none of them. The job now provisions the
 * Zitadel IdP; this guard is the fail-loud half — it reads the vitest JSON
 * report and refuses a run in which an IDP-gated e2e suite silently skipped, or
 * in which a required variable is missing.
 *
 * Each case ships a fixture tree (`apps/api/test/**` spec sources + the report)
 * under `LINT_FIXTURE_ROOT`, the same seam the `tools/lint` guards use, and the
 * environment is set explicitly per case so an ambient CI value cannot leak in.
 */
const GUARD = "../ci/assert-no-skipped-e2e.ts";
const REPORT = "vitest-api.json";

const FULL_ENV: Record<string, string> = {
  DATABASE_URL: "postgres://ds:ds@localhost:5432/ds_test",
  IDP_ISSUER: "http://localhost:9080",
  IDP_SERVICE_TOKEN: "pat",
  IDP_CLIENT_ID: "client",
  IDP_CLIENT_SECRET: "secret",
  IDP_PROJECT_ID: "project",
  // The tier does not stand these up — an empty value is how the guard sees
  // "unprovisioned", on both the Windows dev box and the Linux runner.
  CENTRIFUGO_URL: "",
  S3_ENDPOINT: "",
  MAILPIT_URL: "",
  SMS_SINK_URL: "",
};

function run(name: string, env: Record<string, string> = {}) {
  return runGuard(GUARD, caseDir("assert-no-skipped-e2e", name), {
    extraArgs: [REPORT],
    env: { ...FULL_ENV, ...env },
  });
}

describe("assert-no-skipped-e2e", () => {
  it("passes when every IDP-gated e2e test ran", () => {
    const result = run("all-ran");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("assert-no-skipped-e2e: OK");
  });

  it("fails when an IDP-gated e2e suite skipped", () => {
    const result = run("idp-suite-skipped");
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      "apps/api/test/taxonomy/directions.e2e-spec.ts",
    );
  });

  it("exempts a suite gated on a service this tier does not provision", () => {
    const result = run("unprovisioned-skip");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("assert-no-skipped-e2e: OK");
  });

  it("stops exempting that suite once the service IS provisioned", () => {
    const result = run("unprovisioned-skip", {
      CENTRIFUGO_URL: "http://localhost:8000",
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("apps/api/test/room/chat.e2e-spec.ts");
  });

  it("fails on an IDP-gated skip in a file that ALSO carries an unprovisioned gate", () => {
    const result = run("mixed-gate-file");
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("apps/api/test/me/display-name.e2e-spec.ts");
    // Only the outer, IDP-gated test is unexplained: the inner Centrifugo-gated
    // one is exempt, and the exemption does not spread to the rest of the file.
    expect(result.stderr).toContain("1 skipped test(s)");
    expect(result.stderr).toContain(
      "EARS-14: a gated doctor sets their display name",
    );
    expect(result.stderr).not.toContain("EARS-16");
  });

  it("still exempts the inner unprovisioned-gated test in that same file", () => {
    const result = run("mixed-gate-inner-skip");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("assert-no-skipped-e2e: OK");
  });

  it("fails loudly when a required variable is missing", () => {
    const result = run("all-ran", { IDP_SERVICE_TOKEN: "" });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("IDP_SERVICE_TOKEN");
  });

  it("fails when the report holds no api e2e test at all", () => {
    const result = run("no-e2e-ran");
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("no api e2e test executed");
  });

  it("fails when the report file is absent", () => {
    const result = runGuard(GUARD, caseDir("assert-no-skipped-e2e", "all-ran"), {
      extraArgs: ["absent-report.json"],
      env: FULL_ENV,
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("could not read the vitest JSON report");
  });
});
