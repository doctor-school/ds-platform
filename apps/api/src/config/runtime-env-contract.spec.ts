import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  RUNTIME_ENV_CONTRACT,
  apiBootRequiredRuntimeEnv,
} from "@ds/schemas/runtime-env";
import { describe, expect, it } from "vitest";

import { loadEnv } from "./env.schema.js";

/**
 * #1468 — the api's production boot reads the same required set the release
 * gate (`tools/deploy/prod.mjs` phase `runtime-env`) enforces on the box, so
 * the two cannot drift: a variable the api refuses to boot without is in the
 * contract, and a contract `api` variable missing in production refuses boot
 * with its name (never its value).
 */
const VALUES: Record<string, string> = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  AUDIT_IDENTIFIER_PEPPER: "a".repeat(64),
  LIFECYCLE_IMPACT_TOKEN_SECRET: "b".repeat(64),
};

function productionEnv(): Record<string, string> {
  const env: Record<string, string> = { NODE_ENV: "production" };
  for (const name of apiBootRequiredRuntimeEnv()) {
    const value = VALUES[name];
    if (value === undefined) throw new Error(`no test value for ${name}`);
    env[name] = value;
  }
  return env;
}

describe("1468: the api production boot enforces the runtime-env contract", () => {
  it("the contract's unconditional api set is exactly the boot-required set", () => {
    expect(apiBootRequiredRuntimeEnv()).toEqual([
      "DATABASE_URL",
      "AUDIT_IDENTIFIER_PEPPER",
      "LIFECYCLE_IMPACT_TOKEN_SECRET",
    ]);
  });

  it("boots in production with every contract api variable present", () => {
    expect(() => loadEnv(productionEnv())).not.toThrow();
  });

  for (const name of apiBootRequiredRuntimeEnv()) {
    it(`refuses a production boot without ${name}, naming it`, () => {
      const env = productionEnv();
      delete env[name];
      expect(() => loadEnv(env)).toThrow(new RegExp(name));
    });
  }

  it("2026-08-25: a production boot without LIFECYCLE_IMPACT_TOKEN_SECRET fails fast at env load", () => {
    const env = productionEnv();
    delete env.LIFECYCLE_IMPACT_TOKEN_SECRET;
    expect(() => loadEnv(env)).toThrow(
      /LIFECYCLE_IMPACT_TOKEN_SECRET is required in production/,
    );
  });

  it("treats a blank or template-placeholder value as missing and never prints the value", () => {
    for (const value of ["", "   ", "<openssl-rand-hex-32>"]) {
      const env = { ...productionEnv(), AUDIT_IDENTIFIER_PEPPER: value };
      let message = "";
      try {
        loadEnv(env);
      } catch (e) {
        message = String((e as Error).message);
      }
      expect(message).toMatch(/AUDIT_IDENTIFIER_PEPPER/);
      if (value.trim()) expect(message).not.toContain(value);
    }
  });

  it("lists every missing name in one refusal", () => {
    let message = "";
    try {
      loadEnv({ NODE_ENV: "production", DATABASE_URL: VALUES.DATABASE_URL });
    } catch (e) {
      message = String((e as Error).message);
    }
    expect(message).toMatch(/AUDIT_IDENTIFIER_PEPPER/);
    expect(message).toMatch(/LIFECYCLE_IMPACT_TOKEN_SECRET/);
  });

  it("leaves non-production boots alone (the dev-stand and tests run without the secrets)", () => {
    expect(() =>
      loadEnv({ NODE_ENV: "development", DATABASE_URL: VALUES.DATABASE_URL }),
    ).not.toThrow();
    expect(() => loadEnv({ DATABASE_URL: VALUES.DATABASE_URL })).not.toThrow();
  });
});

// --- startup throws cannot escape the contract ------------------------------

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const SCANNED = ["apps/api/src", "apps/admin/lib"];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== "node_modules") out.push(...sources(path));
    } else if (
      /\.(ts|tsx)$/.test(entry) &&
      !/\.(spec|test|e2e-spec)\.tsx?$/.test(entry)
    ) {
      out.push(path);
    }
  }
  return out;
}

/**
 * The env variables a startup / request path refuses to run without: an
 * `Error` message «NAME is required» / «NAME is not configured» / «NAME is not
 * set», the name written literally or through a `const X = "NAME"`.
 */
function requiredEnvThrows(source: string): string[] {
  const names = new Set<string>();
  const literal =
    /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+) is (?:required|not configured|not set)\b/g;
  for (const m of source.matchAll(literal)) names.add(m[1]!);
  const viaConst = /\$\{(\w+)\} is (?:required|not configured|not set)\b/g;
  for (const m of source.matchAll(viaConst)) {
    const decl = new RegExp(`\\b${m[1]}\\s*=\\s*"([A-Z][A-Z0-9_]+)"`).exec(
      source,
    );
    if (decl) names.add(decl[1]!);
  }
  return [...names];
}

describe("1468: every env variable the api/admin refuses to run without is in the contract", () => {
  it("the scanner finds both spellings (literal and via a name constant)", () => {
    expect(
      requiredEnvThrows(
        'throw new Error("FOO_BAR is required: x"); const N_ENV = "BAZ_QUX"; throw new Error(`${N_ENV} is not set`);',
      ).sort(),
    ).toEqual(["BAZ_QUX", "FOO_BAR"]);
  });

  it("finds the known fail-closed secrets (the scan is not vacuous)", () => {
    const found = new Set(
      SCANNED.flatMap((dir) =>
        sources(join(REPO_ROOT, dir)).flatMap((f) =>
          requiredEnvThrows(readFileSync(f, "utf8")),
        ),
      ),
    );
    expect(found).toContain("LIFECYCLE_IMPACT_TOKEN_SECRET");
    expect(found).toContain("AUDIT_IDENTIFIER_PEPPER");
    expect(found).toContain("ACADEMY_PUBLIC_ORIGIN");
  });

  it("no scanned throw names a variable missing from the contract", () => {
    const contract = new Set(RUNTIME_ENV_CONTRACT.variables.map((v) => v.name));
    const missing: string[] = [];
    for (const dir of SCANNED) {
      for (const file of sources(join(REPO_ROOT, dir))) {
        for (const name of requiredEnvThrows(readFileSync(file, "utf8"))) {
          if (!contract.has(name)) missing.push(`${name} (${file})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
