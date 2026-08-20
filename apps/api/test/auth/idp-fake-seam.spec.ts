import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { ZitadelIdpClient } from "../../src/auth/idp/zitadel.idp.js";

/**
 * The fake-IdP test seam, pinned.
 *
 * Two independent drifts have each turned five e2e suites red at once, and
 * neither surfaced as a single readable failure (#1378):
 *
 * 1. **Port drift** — a method added to `ZitadelIdpClient` and not to
 *    `FakeIdpClient`. Every suite that reaches it dies on
 *    `x is not a function`, far from the cause. Memory rule «fake no more
 *    permissive than real» has a structural precondition: the fake must expose
 *    at least the real adapter's method surface.
 * 2. **Binding drift** — a suite reading its "fake" back off the Nest container
 *    (`app.get(IDP_CLIENT)`) instead of binding one. `IdpModule` picks the REAL
 *    adapter whenever `IDP_ISSUER` + `IDP_SERVICE_TOKEN` are configured, which
 *    is the normal state of a developer's dev-stand — so such a suite is green
 *    on CI (no IdP configured) and red on every stand, and the test-only
 *    accessors it drives are missing from the object it got.
 *
 * A pure unit spec: no app boot, no database, so it runs in the shared CI unit
 * job and fails FIRST, before the e2e fan-out.
 */
describe("003 fake-IdP test seam", () => {
  function methodsOf(proto: object): string[] {
    return Object.getOwnPropertyNames(proto).filter(
      (name) =>
        name !== "constructor" &&
        typeof (proto as Record<string, unknown>)[name] === "function",
    );
  }

  /**
   * The `IdpClient` port's method names, read off the interface declaration —
   * the only shared surface the two adapters owe each other. Comparing the two
   * prototypes directly would drag in the real adapter's private HTTP helpers,
   * which the fake has no business implementing.
   */
  function portMethods(): string[] {
    const src = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../../src/auth/idp/idp.types.ts",
      ),
      "utf8",
    );
    const body = /export interface IdpClient\s*\{([\s\S]*?)\n\}/.exec(src)?.[1];
    expect(body, "IdpClient interface not found in idp.types.ts").toBeTruthy();
    return [...body!.matchAll(/^ {2}(\w+)\s*\(/gm)].map((m) => m[1]!);
  }

  it("both adapters implement the whole IdpClient port", () => {
    const port = portMethods();
    expect(port.length).toBeGreaterThan(5);
    for (const [label, proto] of [
      ["FakeIdpClient", FakeIdpClient.prototype],
      ["ZitadelIdpClient", ZitadelIdpClient.prototype],
    ] as const) {
      const have = new Set(methodsOf(proto));
      expect(
        port.filter((name) => !have.has(name)),
        `${label} is missing IdpClient methods — a port method added on one ` +
          "side only is the drift that turns whole e2e suites red at their " +
          "first call rather than here",
      ).toEqual([]);
    }
  });

  it("the test-only accessors the mfa suites drive are present on the fake", () => {
    // Not part of `IdpClient` (the real adapter can neither set nor re-read a
    // factor), so the parity check above cannot cover them — they are the seam
    // the 011 mfa suites reach the "already enrolled" / challenge branches by.
    for (const accessor of [
      "setTotpFactor",
      "totpSecretFor",
      "grantProjectRole",
    ]) {
      expect(
        typeof (FakeIdpClient.prototype as Record<string, unknown>)[accessor],
        `FakeIdpClient.${accessor} is the mfa suites' test seam`,
      ).toBe("function");
    }
  });

  it("no suite reads its fake IdP back off the container instead of binding it", () => {
    const testRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
    const specs: string[] = [];
    (function walk(dir: string): void {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith("e2e-spec.ts")) specs.push(full);
      }
    })(testRoot);

    // Reading `IDP_CLIENT` back off the container is only safe when THIS suite
    // put the instance there, so the file must carry at least as many
    // `.overrideProvider(IDP_CLIENT)` bindings as container reads — a file with
    // more reads than bindings has a `describe` running against whatever
    // `IdpModule` chose.
    const reads = /\.get<[^>]*>\(\s*IDP_CLIENT\s*\)/g;
    const binds = /\.overrideProvider\(\s*IDP_CLIENT\s*\)/g;
    const offenders = specs
      .filter((file) => {
        const src = readFileSync(file, "utf8");
        return (src.match(reads) ?? []).length > (src.match(binds) ?? []).length;
      })
      .map((file) => relative(testRoot, file).replace(/\\/g, "/"));
    expect(
      offenders,
      "these suites read IDP_CLIENT off the container — on a configured " +
        "dev-stand that is the REAL Zitadel adapter; bind the fake with " +
        ".overrideProvider(IDP_CLIENT).useValue(fake) instead",
    ).toEqual([]);
  });
});
