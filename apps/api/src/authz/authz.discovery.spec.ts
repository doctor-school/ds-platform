import { Controller, Delete, Get, Module } from "@nestjs/common";
import { DiscoveryModule, NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Authz, Public } from "./authz.decorator.js";
import { collectAuthzRows } from "./authz.discovery.js";
import type { INestApplicationContext } from "@nestjs/common";

@Controller({ path: "good", version: "1" })
class GoodController {
  @Get("ping")
  @Public()
  @Authz({ access: "public", check: "none", audit: "none", tests: ["EARS-1"] })
  ping(): void {}

  @Delete("session")
  @Authz({
    access: "authenticated",
    roles: ["doctor_guest"],
    check: "fast-path",
    audit: "low-stakes",
    tests: ["EARS-10"],
  })
  logout(): void {}
}

@Controller({ path: "bad", version: "1" })
class BadController {
  // Deliberately unclassified — the gate must flag this as a violation.
  @Get("leak")
  leak(): void {}
}

@Controller({ path: "invalid", version: "1" })
class InvalidController {
  // Present-but-INVALID @Authz (type-valid, semantically broken): `authenticated`
  // with no `required_roles` and `auth_check: none` violates the §3.1
  // interdependencies. This exercises the gate's `meta != null` validity path —
  // distinct from BadController's `meta == null` "missing" path.
  @Get("weak")
  @Authz({
    access: "authenticated",
    check: "none",
    audit: "none",
    tests: ["EARS-2"],
  })
  weak(): void {}
}

@Module({
  imports: [DiscoveryModule],
  controllers: [GoodController, BadController, InvalidController],
})
class FixtureModule {}

describe("collectAuthzRows (completeness gate over the real route set)", () => {
  let app: INestApplicationContext;

  beforeAll(async () => {
    app = await NestFactory.createApplicationContext(FixtureModule, {
      logger: false,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("derives a row for each classified route with its real METHOD /vN/path", () => {
    const { rows } = collectAuthzRows(app);
    const endpoints = rows.map((r) => r.endpoint).sort();
    expect(endpoints).toContain("GET /v1/good/ping");
    expect(endpoints).toContain("DELETE /v1/good/session");
  });

  it("flags an unclassified route as a violation (fail-closed completeness)", () => {
    const { violations } = collectAuthzRows(app);
    expect(violations.some((m) => m.includes("/v1/bad/leak"))).toBe(true);
  });

  it("reports no violation for the well-classified routes", () => {
    const { violations } = collectAuthzRows(app);
    expect(violations.some((m) => m.includes("/v1/good/"))).toBe(false);
  });

  it("flags a present-but-invalid @Authz on the validity path — not as 'missing'", () => {
    const { violations } = collectAuthzRows(app);
    const own = violations.filter((m) => m.includes("/v1/invalid/weak"));
    // The §3.1 interdependency breach surfaces through the real boot…
    expect(own.length).toBeGreaterThan(0);
    // …and it is NOT mistaken for the unclassified/missing-metadata case.
    expect(own.some((m) => /missing @Authz/.test(m))).toBe(false);
  });
});
