import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  RUNTIME_ENV_CONTRACT,
  apiBootRequiredRuntimeEnv,
} from "@ds/schemas/runtime-env";
import { describe, expect, it } from "vitest";

import { ApiEnvSchema, loadEnv } from "./env.schema.js";

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
  DOCTOR_PUBLIC_ORIGIN: "https://doctor.school",
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
      "DOCTOR_PUBLIC_ORIGIN",
    ]);
  });

  it("every ApiEnvSchema field the api cannot boot without is in the contract's api set", () => {
    // A field with no `.optional()` / `.default()` refuses the boot when its
    // variable is absent (as DATABASE_URL does), so the release gate must know it.
    const hardRequired = Object.entries(ApiEnvSchema.shape)
      .filter(([, field]) => !field.safeParse(undefined).success)
      .map(([name]) => name);
    expect(hardRequired).toContain("DATABASE_URL");
    expect(
      hardRequired.filter((n) => !apiBootRequiredRuntimeEnv().includes(n)),
    ).toEqual([]);
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
/**
 * The api, the admin, both storefronts (portal = Academy, doctor) and the shared
 * storefront shell whose sibling-origin reader both storefronts call at request
 * time (#3147). A directory is walked; a file is read as is.
 */
const SCANNED = [
  "apps/api/src",
  "apps/admin/app",
  "apps/admin/lib",
  "apps/portal/app",
  "apps/portal/lib",
  "apps/portal/middleware.ts",
  "apps/doctor/app",
  "apps/doctor/lib",
  "apps/doctor/proxy.ts",
  "packages/storefront-shell/src",
];

const SOURCE_FILE = /\.(ts|tsx)$/;
const TEST_FILE = /\.(spec|test|e2e-spec)\.tsx?$/;

function sources(path: string): string[] {
  if (!statSync(path).isDirectory()) {
    return SOURCE_FILE.test(path) && !TEST_FILE.test(path) ? [path] : [];
  }
  const out: string[] = [];
  for (const entry of readdirSync(path)) {
    if (entry === "node_modules") continue;
    out.push(...sources(join(path, entry)));
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
    if (decl) {
      names.add(decl[1]!);
      continue;
    }
    // The boot check's own refusal loops over the contract's names
    // (`for (const name of …)` in a module reading `@ds/schemas/runtime-env`).
    if (
      source.includes('"@ds/schemas/runtime-env"') &&
      new RegExp(`\\bfor \\(const ${m[1]} of\\b`).test(source)
    ) {
      continue;
    }
    // `const name = NAMES[key]` over `const NAMES = { a: "X_Y", … }`: every value.
    const lookup = new RegExp(`\\b${m[1]}\\s*=\\s*(\\w+)\\[`).exec(source);
    const table =
      lookup &&
      new RegExp(`\\b${lookup[1]}\\s*=\\s*\\{([^}]*)\\}`).exec(source);
    if (!table) {
      // Fail closed: a throw the scan cannot resolve must not pass silently.
      names.add(`<unresolved \${${m[1]}}>`);
      continue;
    }
    for (const v of table[1]!.matchAll(/"([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)"/g)) {
      names.add(v[1]!);
    }
  }
  return [...names];
}

describe("1468: every env variable the api/admin/storefronts refuse to run without is in the contract", () => {
  it("the scanner finds both spellings (literal and via a name constant)", () => {
    expect(
      requiredEnvThrows(
        'throw new Error("FOO_BAR is required: x"); const N_ENV = "BAZ_QUX"; throw new Error(`${N_ENV} is not set`);',
      ).sort(),
    ).toEqual(["BAZ_QUX", "FOO_BAR"]);
  });

  it("the scanner resolves a name looked up in a constant table, and flags what it cannot resolve", () => {
    expect(
      requiredEnvThrows(
        'const T = { a: "ONE_ENV", b: "TWO_ENV" } as const; const name = T[host]; throw new Error(`${name} is not set`);',
      ).sort(),
    ).toEqual(["ONE_ENV", "TWO_ENV"]);
    expect(
      requiredEnvThrows("throw new Error(`${dynamic} is required`);"),
    ).toEqual(["<unresolved ${dynamic}>"]);
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
    expect(found).toContain("DOCTOR_PUBLIC_ORIGIN");
  });

  it("no scanned throw names a variable that neither the contract nor the prod compose supplies", () => {
    // A value the prod compose file pins literally under `environment:` (e.g. a
    // volume path) never comes from api.env, so it is not the contract's; an
    // interpolated `${…}` value is not a pin.
    const pinned = new Set(
      [
        ...readFileSync(
          join(REPO_ROOT, "infra/deploy/compose/api-prod/compose.yml"),
          "utf8",
        ).matchAll(/^\s+([A-Z][A-Z0-9_]+):[ \t]*(?!\$\{)(\S.*)$/gm),
      ].map((m) => m[1]!),
    );
    expect(pinned).toContain("ACADEMY_SUBMISSIONS_DIR");
    const contract = new Set(RUNTIME_ENV_CONTRACT.variables.map((v) => v.name));
    const missing: string[] = [];
    for (const dir of SCANNED) {
      for (const file of sources(join(REPO_ROOT, dir))) {
        for (const name of requiredEnvThrows(readFileSync(file, "utf8"))) {
          if (!contract.has(name) && !pinned.has(name)) {
            missing.push(`${name} (${file})`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
