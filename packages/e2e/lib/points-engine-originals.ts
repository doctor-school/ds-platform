import { createHash, randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDrizzle, type DrizzleHandle } from "@ds/db";
import { expect } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const apiRequire = createRequire(resolve(root, "apps/api/package.json"));
export interface EngineFact {
  type: string;
  eventId: string;
  personId: string;
  occurredAt: Date;
  ref?: string;
  attributes: Record<string, unknown>;
  attribution?: { organisationId?: string; memberId?: string };
}
export interface EngineResult {
  outcome: string;
  applied: { ruleId: string; ruleVersion: number }[];
  trace: { ruleId: string; verdict: string }[];
}
interface Engine {
  record(fact: EngineFact): Promise<EngineResult>;
}
interface Ledger {
  readPersonAccount(personId: string): Promise<{
    pul: { unit: string; available: number; reserved: number };
    advance: { open: number; remaining: number };
  }>;
  close(personId: string, at: Date): Promise<{ closedAt: Date | null }>;
}
interface Prices {
  put(
    ref: string,
    input: {
      itemKind: "event";
      mode: "threshold" | "advance" | "open";
      pulCost: number;
      limitedSeats: boolean;
    },
    actor: null,
  ): Promise<unknown>;
  gating(
    personId: string,
    ref: string,
  ): Promise<{
    pulCost: number;
    unit: "Pul";
    decision: string;
    shortfall: number;
    earnHint?: { pulToEarn: number; lessonsNeeded: number };
  }>;
}
type Constructor<T> = new (...args: unknown[]) => T;
export interface RulePublication {
  row: {
    ruleId: string;
    version: number;
    kind: string;
    triggerFactTypes: string[];
    parameters: Record<string, unknown>;
    effectiveFrom: Date;
    publishedBy: string | null;
  };
  warnings: { code: string; factType: string; otherRuleId: string }[];
}
interface RuleBook {
  publish(input: {
    ruleId: string;
    parameters: unknown;
    actorSub: string | null;
  }): Promise<RulePublication>;
}
export interface PointsWorld {
  handle: DrizzleHandle;
  engine: Engine;
  ledger: Ledger;
  prices: Prices;
  rules: RuleBook;
  ownedRules: {
    ruleId: string;
    parameters: Record<string, unknown>;
    actorSub: string;
  }[];
  ruleBookTouched?: boolean;
  seedSnapshot?: unknown[];
  applicationName: string;
  ownedEventIds: string[];
  registrationFact: (input: {
    registrationId: string;
    personId: string;
    itemRef: string;
    occurredAt: Date;
  }) => EngineFact;
  personId: string;
  lessonId: string;
  facts: EngineFact[];
  seedVersions: Map<string, number>;
  result?: EngineResult;
  refused?: unknown;
  before?: unknown[];
  answers: EngineResult[];
  postingSnapshot?: unknown[];
  journalSnapshot?: unknown[];
}

export function pointsOperation(command: string): void {
  const file = process.env.E2E_POINTS_OPS_LOG;
  if (!file) throw new Error("E2E_POINTS_OPS_LOG must name the command log");
  appendFileSync(
    file,
    JSON.stringify({ at: new Date().toISOString(), command }) + "\n",
  );
}

export async function startPointsWorld(): Promise<PointsWorld> {
  const connection = process.env.DATABASE_URL;
  const database = process.env.E2E_POINTS_DATABASE;
  if (
    !connection ||
    !database ||
    !(
      database === "ds_dev_3968" ||
      (process.env.CI === "true" && database === "ds_test")
    ) ||
    decodeURIComponent(new URL(connection).pathname.slice(1)) !== database
  ) {
    throw new Error(
      "025 originals require the explicitly owned #3968 database (or CI ds_test)",
    );
  }
  pointsOperation(`CONNECT ${database}`);
  const applicationName = `points-3968-${randomUUID()}`;
  const scopedConnection = new URL(connection);
  scopedConnection.searchParams.set("application_name", applicationName);
  const handle = createDrizzle(scopedConnection.href, { max: 3 });
  handle.pool.on("connect", (client) => {
    const execute = client.query.bind(client) as (
      ...args: unknown[]
    ) => unknown;
    client.query = ((...args: unknown[]) => {
      const first = args[0];
      const sql =
        typeof first === "string" ? first : (first as { text?: string })?.text;
      pointsOperation(sql ?? "PG query (parameters redacted)");
      return execute(...args);
    }) as typeof client.query;
  });
  try {
    expect(
      (await handle.pool.query("SELECT current_database() AS name")).rows,
    ).toEqual([{ name: database }]);
    // Lazy compiled imports keep ordinary storefront BDD generation independent of the API build.
    const load = (path: string) =>
      import(pathToFileURL(resolve(root, path)).href);
    const { PointsLedgerService } = (await load(
      "apps/api/dist/points/points-ledger.service.js",
    )) as { PointsLedgerService: Constructor<Ledger> };
    const { RuleBookService } = (await load(
      "apps/api/dist/points/rule-book.service.js",
    )) as { RuleBookService: Constructor<RuleBook> };
    const { PointsEventsPublisher } = (await load(
      "apps/api/dist/points/points-events.js",
    )) as { PointsEventsPublisher: Constructor<unknown> };
    const { PointsEngine } = (await load(
      "apps/api/dist/points/engine/points-engine.service.js",
    )) as { PointsEngine: Constructor<Engine> };
    const { PointsPricesService } = (await load(
      "apps/api/dist/points/points-prices.service.js",
    )) as { PointsPricesService: Constructor<Prices> };
    const { registrationCreatedFact } = (await load(
      "apps/api/dist/points/registration-facts.js",
    )) as { registrationCreatedFact: PointsWorld["registrationFact"] };
    const ledger = new PointsLedgerService(handle.db);
    const rules = new RuleBookService(handle.db);
    const engine = new PointsEngine(
      handle.db,
      rules,
      ledger,
      new PointsEventsPublisher(),
    );
    return {
      handle,
      engine,
      ledger,
      rules,
      ownedRules: [],
      prices: new PointsPricesService(handle.db, engine),
      applicationName,
      ownedEventIds: [],
      registrationFact: registrationCreatedFact,
      personId: randomUUID(),
      lessonId: randomUUID(),
      facts: [],
      seedVersions: new Map(),
      answers: [],
    };
  } catch (error) {
    await handle.pool.end();
    throw error;
  }
}

export async function retirePointsEvents(world: PointsWorld): Promise<void> {
  if (world.ownedEventIds.length === 0) return;
  // ADR-0003 design section 3.6: retain event rows and their ledger references.
  const { rows } = await world.handle.pool.query<{
    id: string;
    record_status: string;
    deleted_at: Date;
  }>(
    `UPDATE events SET record_status = 'retired', deleted_at = now()
     WHERE id = ANY($1::uuid[]) AND slug = 'points-reserve-' || id::text
     RETURNING id, record_status, deleted_at`,
    [world.ownedEventIds],
  );
  expect(rows.map((row) => row.id).sort()).toEqual(
    [...world.ownedEventIds].sort(),
  );
  for (const row of rows) {
    expect(row.record_status).toBe("retired");
    expect(row.deleted_at).toBeInstanceOf(Date);
  }
}

export async function assertSeedDefaults(world: PointsWorld): Promise<void> {
  const { POINTS_ENGINE_SEED, pointsRuleTriggerFactTypes } = apiRequire(
    "@ds/schemas",
  ) as {
    POINTS_ENGINE_SEED: { ruleId: string; body: { kind: string } }[];
    pointsRuleTriggerFactTypes: (body: unknown) => string[];
  };
  for (const seed of POINTS_ENGINE_SEED) {
    const { rows } = await world.handle.pool.query(
      `SELECT version, kind, trigger_fact_types, parameters, effective_from, published_by FROM points_rule_versions
       WHERE rule_id = $1 AND kind IS NOT NULL AND effective_from <= now() ORDER BY version DESC LIMIT 1`,
      [seed.ruleId],
    );
    expect(rows, seed.ruleId).toHaveLength(1);
    const { version, ...row } = rows[0]!;
    expect(version).toBeGreaterThan(0);
    world.seedVersions.set(seed.ruleId, version);
    expect(row).toEqual({
      kind: seed.body.kind,
      trigger_fact_types: pointsRuleTriggerFactTypes(seed.body),
      parameters: seed.body,
      effective_from: new Date(0),
      published_by: null,
    });
  }
  world.seedSnapshot = (
    await world.handle.pool.query(
      "SELECT * FROM points_rule_versions WHERE rule_id = ANY($1::text[]) ORDER BY rule_id, version",
      [POINTS_ENGINE_SEED.map((seed) => seed.ruleId)],
    )
  ).rows;
}

export async function retirePointsRules(world: PointsWorld): Promise<void> {
  if (!world.ruleBookTouched) return;
  const failures: unknown[] = [];
  for (const own of world.ownedRules) {
    try {
      const parameters = { ...own.parameters, active: false };
      const retired = await world.rules.publish({ ...own, parameters });
      const stored = (
        await world.handle.pool.query(
          "SELECT version, parameters, published_by FROM points_rule_versions WHERE rule_id=$1 ORDER BY version DESC LIMIT 1",
          [own.ruleId],
        )
      ).rows;
      expect(stored).toEqual([
        {
          version: retired.row.version,
          parameters,
          published_by: retired.row.publishedBy,
        },
      ]);
      expect(retired.row.parameters.active).toBe(false);
      pointsOperation(
        "RULEBOOK " +
          JSON.stringify({
            kind: "owned-rule-retirement",
            ruleId: own.ruleId,
            version: retired.row.version,
            latestInactive: true,
            publishedBy: retired.row.publishedBy,
          }),
      );
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    const before = world.seedSnapshot!;
    const ids = [
      ...new Set(before.map((row) => (row as { rule_id: string }).rule_id)),
    ];
    const after = (
      await world.handle.pool.query(
        "SELECT * FROM points_rule_versions WHERE rule_id = ANY($1::text[]) ORDER BY rule_id, version",
        [ids],
      )
    ).rows;
    expect(after).toEqual(before);
    const hash = (value: unknown) =>
      createHash("sha256").update(JSON.stringify(value)).digest("hex");
    pointsOperation(
      "RULEBOOK " +
        JSON.stringify({
          kind: "seed-invariant",
          beforeSha256: hash(before),
          afterSha256: hash(after),
          unchanged: true,
          rows: after.length,
        }),
    );
  } catch (error) {
    failures.push(error);
  }
  if (failures.length)
    throw new AggregateError(failures, "Rulebook cleanup failed");
}

export function parseGatingDecision(value: unknown): Record<string, unknown> {
  const { PointsGatingDecisionSchema } = apiRequire("@ds/schemas") as {
    PointsGatingDecisionSchema: {
      parse(input: unknown): Record<string, unknown>;
    };
  };
  return PointsGatingDecisionSchema.parse(value);
}

export async function prepareDoctor(
  world: PointsWorld,
  personId = world.personId,
): Promise<void> {
  let specialty = (
    await world.handle.pool.query(
      "SELECT id FROM specialties_minzdrav WHERE name = $1",
      ["Кардиология"],
    )
  ).rows[0];
  if (!specialty) {
    const seed = (await import(
      pathToFileURL(
        resolve(root, "packages/db/dist/seed/specialties-minzdrav.js"),
      ).href
    )) as {
      seedSpecialtiesMinzdrav: (db: unknown) => Promise<number>;
    };
    await world.handle.db.transaction(async (tx) => {
      await seed.seedSpecialtiesMinzdrav(tx);
    });
    specialty = (
      await world.handle.pool.query(
        "SELECT id FROM specialties_minzdrav WHERE name = $1",
        ["Кардиология"],
      )
    ).rows[0];
  }
  expect(specialty?.id).toBeTruthy();
  await world.handle.pool.query(
    `INSERT INTO users (id, zitadel_sub, email, phone, phone_verified, role)
     VALUES ($1, $2, $3, $4, true, 'doctor_verified')`,
    [
      personId,
      `points-original:${personId}`,
      `${personId}@points-original.invalid`,
      `+7999${personId.replace(/\D/g, "").padEnd(7, "0").slice(0, 7)}`,
    ],
  );
  await world.handle.pool.query(
    "INSERT INTO doctor_specialties (doctor_id, specialty_id) VALUES ($1, $2)",
    [personId, specialty!.id],
  );
  expect(
    (
      await world.handle.pool.query(
        `SELECT u.phone_verified, u.phone IS NOT NULL AS has_phone, s.name FROM users u
     JOIN doctor_specialties d ON d.doctor_id=u.id JOIN specialties_minzdrav s ON s.id=d.specialty_id WHERE u.id=$1`,
        [personId],
      )
    ).rows,
  ).toEqual([{ phone_verified: true, has_phone: true, name: "Кардиология" }]);
  const fact = {
    type: "phone.verified",
    eventId: `points-original-phone:${randomUUID()}`,
    personId: personId,
    occurredAt: new Date(),
    attributes: {},
  };
  await world.engine.record(fact);
  expect(
    (
      await world.handle.pool.query(
        "SELECT type, person_id FROM points_facts WHERE event_id=$1",
        [fact.eventId],
      )
    ).rows,
  ).toEqual([{ type: "phone.verified", person_id: personId }]);
}

export async function postings(world: PointsWorld, eventId?: string) {
  const { rows } = await world.handle.pool.query(
    `SELECT p.event_id, p.rule_id, p.rule_version, p.denomination, p.amount FROM points_postings p
     JOIN points_accounts a ON a.id=p.credit_account_id
     WHERE a.subject_id=$1 AND ($2::text IS NULL OR p.event_id LIKE $2 || '#%') ORDER BY p.event_id, p.leg`,
    [world.personId, eventId ?? null],
  );
  return rows;
}

export async function recordLesson(
  world: PointsWorld,
  mode: string,
): Promise<void> {
  world.before = await postings(world);
  const fact = {
    type: "lesson.completed",
    eventId: `points-original-lesson:${randomUUID()}`,
    personId: world.personId,
    ref: world.lessonId,
    occurredAt: new Date(),
    attributes: { mode },
  };
  world.facts.push(fact);
  world.result = await world.engine.record(fact);
}
