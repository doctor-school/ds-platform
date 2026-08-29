export interface RegisteredFixtureIdentity {
  email: string;
  sub: string;
}

export interface FixtureMirrorIdentity {
  sub: string;
  email: string | null;
}

/**
 * Register a fixture, retrying only the FakeIdP's confirmed per-process subject
 * collision against a retained mirror row from an earlier branch-DB run.
 */
export async function registerUniqueUserFixture(input: {
  nextEmail: () => string;
  register: (email: string) => Promise<{ statusCode: number; payload: string }>;
  idpSubForEmail: (email: string) => Promise<string | null>;
  mirrorByEmail: (email: string) => Promise<FixtureMirrorIdentity | null>;
  mirrorBySub: (sub: string) => Promise<FixtureMirrorIdentity | null>;
  maxAttempts?: number;
}): Promise<RegisteredFixtureIdentity> {
  const maxAttempts = input.maxAttempts ?? 20;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const email = input.nextEmail();
    const response = await input.register(email);
    if (response.statusCode !== 200) {
      throw new Error(
        `fixture registration failed with ${response.statusCode}: ${response.payload}`,
      );
    }
    const sub = await input.idpSubForEmail(email);
    if (!sub) throw new Error("fixture registration returned no IdP subject");

    const byEmail = await input.mirrorByEmail(email);
    if (byEmail?.sub === sub) return { email, sub };

    const bySub = await input.mirrorBySub(sub);
    const confirmedSubjectCollision =
      byEmail === null && bySub !== null && bySub.email !== email;
    if (confirmedSubjectCollision) continue;

    throw new Error(
      "fixture mirror missing without a confirmed subject collision",
    );
  }
  throw new Error(
    `fixture registration exhausted ${maxAttempts} confirmed subject collisions`,
  );
}

/** Real Fastify/Postgres/FakeIdP adapter used by shared-stand e2e suites. */
export function registerUniqueFakeUserFixture(input: {
  app: NestFastifyApplication;
  pool: pg.Pool;
  fake: FakeIdpClient;
  nextEmail: () => string;
  password: string;
  consent: { purpose: string; version: string }[];
}): Promise<RegisteredFixtureIdentity> {
  return registerUniqueUserFixture({
    nextEmail: input.nextEmail,
    register: async (email) => {
      const response = await input.app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password: input.password, consent: input.consent },
      });
      return { statusCode: response.statusCode, payload: response.payload };
    },
    idpSubForEmail: async (email) =>
      (await input.fake.listUsers()).find((user) => user.email === email)
        ?.sub ?? null,
    mirrorByEmail: (email) => mirrorIdentity(input.pool, "email", email),
    mirrorBySub: (sub) => mirrorIdentity(input.pool, "zitadel_sub", sub),
  });
}

async function mirrorIdentity(
  pool: pg.Pool,
  by: "email" | "zitadel_sub",
  value: string,
): Promise<FixtureMirrorIdentity | null> {
  const { rows } = await pool.query<{
    zitadel_sub: string;
    email: string | null;
  }>(`SELECT zitadel_sub, email FROM users WHERE ${by} = $1`, [value]);
  const row = rows[0];
  return row ? { sub: row.zitadel_sub, email: row.email } : null;
}
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type pg from "pg";
import type { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
