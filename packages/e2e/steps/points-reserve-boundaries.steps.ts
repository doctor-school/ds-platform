import { createHash, randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { createDrizzle } from "@ds/db";
import { SEED_EVENT_KINDS } from "@ds/db/seed/golden";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import {
  pointsOperation,
  retirePointsEvents,
  type EngineFact,
  type PointsWorld,
} from "../lib/points-engine-originals.js";
import { test } from "./points-engine-originals.steps.js";

const { Given, When, Then, After } = createBdd(test);
interface ReserveCase {
  items: string[];
  facts: EngineFact[];
  before?: unknown;
  decision?: { decision: string; shortfall: number };
  refused?: unknown;
  outcomes?: PromiseSettledResult<unknown>[];
}
const cases = new WeakMap<PointsWorld, ReserveCase>();
function state(points: PointsWorld): ReserveCase {
  let value = cases.get(points);
  if (!value) {
    value = { items: points.ownedEventIds, facts: [] };
    cases.set(points, value);
  }
  return value;
}

export async function fund(points: PointsWorld, amount: number) {
  for (let earned = 0; earned < amount;) {
    const module = amount - earned >= 20;
    const answer = await points.engine.record({
      type: module ? "module.completed" : "lesson.completed",
      eventId: `points-reserve-fund:${randomUUID()}`,
      personId: points.personId,
      ref: randomUUID(),
      occurredAt: new Date(),
      attributes: { mode: "online" },
    });
    expect(answer.outcome).toBe("applied");
    earned += module ? 20 : 10;
  }
  expect(
    (await points.ledger.readPersonAccount(points.personId)).pul.available,
  ).toBe(amount);
}

export async function unpricedEvent(points: PointsWorld) {
  const id = randomUUID();
  await points.handle.pool.query(
    `INSERT INTO events (id, slug, title, school, starts_at, duration_min, description,
     specialties, partner_ref, program_pdf_ref, state, kind_id, audience)
     VALUES ($1,$2,$3,$4,$5,60,'',$6,NULL,NULL,'published',$7,'doctors')`,
    [
      id,
      `points-reserve-${id}`,
      "Событие с ценой",
      "Кардиология",
      new Date(),
      ["cardiology"],
      SEED_EVENT_KINDS.vstrechaKluba.id,
    ],
  );
  state(points).items.push(id);
  return id;
}

export async function pricedEvent(
  points: PointsWorld,
  pulCost: number,
  limitedSeats = false,
  mode: "threshold" | "advance" | "open" = "threshold",
) {
  const id = await unpricedEvent(points);
  await points.prices.put(
    id,
    { itemKind: "event", mode, pulCost, limitedSeats },
    null,
  );
  expect(
    (
      await points.handle.pool.query(
        "SELECT item_kind, mode, pul_cost, limited_seats FROM points_prices WHERE item_ref=$1",
        [id],
      )
    ).rows,
  ).toEqual([
    {
      item_kind: "event",
      mode,
      pul_cost: pulCost,
      limited_seats: limitedSeats,
    },
  ]);
  return id;
}
function signUp(points: PointsWorld, itemRef: string) {
  const fact = points.registrationFact({
    registrationId: randomUUID(),
    personId: points.personId,
    itemRef,
    occurredAt: new Date(),
  });
  state(points).facts.push(fact);
  return fact;
}
export async function snapshot(points: PointsWorld) {
  return (
    await points.handle.pool.query(
      `
    WITH own AS (SELECT id FROM points_accounts WHERE subject_kind='person' AND subject_id=$1)
    SELECT
      (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id), '[]') FROM points_accounts a WHERE id IN (SELECT id FROM own)) AS accounts,
      (SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY event_id), '[]') FROM points_facts f WHERE person_id=$1) AS journal,
      (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY event_id, leg), '[]') FROM points_postings p WHERE debit_account_id IN (SELECT id FROM own) OR credit_account_id IN (SELECT id FROM own)) AS postings,
      (SELECT coalesce(jsonb_agg(to_jsonb(k) ORDER BY event_id), '[]') FROM points_posting_keys k WHERE event_id IN (SELECT p.event_id FROM points_postings p WHERE debit_account_id IN (SELECT id FROM own) OR credit_account_id IN (SELECT id FROM own))) AS keys,
      (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY registration_id), '[]') FROM points_reserves r WHERE person_account_id IN (SELECT id FROM own)) AS holds,
      (SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY registration_id), '[]') FROM points_obligations o WHERE person_account_id IN (SELECT id FROM own)) AS obligations,
      (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY item_ref), '[]') FROM points_prices p WHERE item_ref=ANY($2::text[])) AS prices`,
      [points.personId, state(points).items],
    )
  ).rows[0];
}
After("@points-reserve-boundaries", async ({ points }) => {
  if (points.ownedEventIds.length === 0) return;
  const before = await snapshot(points);
  await retirePointsEvents(points);
  const after = await snapshot(points);
  expect(after).toEqual(before);
  const receipt =
    process.env.E2E_POINTS_CLEANUP_REPORT ?? process.env.E2E_POINTS_OPS_LOG;
  appendFileSync(
    receipt!,
    JSON.stringify({
      phase: "owned-event-cleanup",
      database: process.env.E2E_POINTS_DATABASE,
      personId: points.personId,
      eventIds: points.ownedEventIds,
      retired: points.ownedEventIds.length,
      active: 0,
      ledgerUnchanged: true,
      beforeSha256: createHash("sha256")
        .update(JSON.stringify(before))
        .digest("hex"),
      afterSha256: createHash("sha256")
        .update(JSON.stringify(after))
        .digest("hex"),
    }) + "\n",
  );
});

async function noFact(points: PointsWorld, fact: EngineFact) {
  expect(
    (
      await points.handle.pool.query(
        `SELECT
    (SELECT count(*) FROM points_facts WHERE event_id=$1) AS journal,
    (SELECT count(*) FROM points_postings WHERE event_id LIKE $1 || '#%') AS postings,
    (SELECT count(*) FROM points_posting_keys WHERE event_id LIKE $1 || '#%') AS keys,
    (SELECT count(*) FROM points_reserves WHERE registration_id=$2) AS holds`,
        [fact.eventId, fact.attributes.registrationId],
      )
    ).rows,
  ).toEqual([{ journal: "0", postings: "0", keys: "0", holds: "0" }]);
}
async function register(points: PointsWorld, item: string) {
  try {
    await points.engine.record(signUp(points, item));
  } catch (error) {
    state(points).refused = error;
  }
}

Given(
  '"A" holds 3 open reserves on limited-seat events',
  async ({ points }) => {
    await fund(points, 40);
    for (let index = 0; index < 3; index += 1) {
      const item = await pricedEvent(points, 10, true);
      expect((await points.engine.record(signUp(points, item))).outcome).toBe(
        "applied",
      );
    }
    expect(
      (await points.ledger.readPersonAccount(points.personId)).pul,
    ).toEqual({ unit: "Pul", available: 10, reserved: 30 });
    expect((await snapshot(points)).holds).toHaveLength(3);
  },
);
When(
  '"A" asks to reserve a seat on a fourth limited-seat event',
  async ({ points }) => {
    const item = await pricedEvent(points, 10, true);
    state(points).before = await snapshot(points);
    await register(points, item);
  },
);
Then(
  'the reserve is refused with problem "points-reserve-limit" and no posting is written',
  async ({ points }) => {
    expect(state(points).refused).toMatchObject({
      problem: "points-reserve-limit",
    });
    await noFact(points, state(points).facts[3]!);
    expect(await snapshot(points)).toEqual(state(points).before);
  },
);

Given(
  '"A" has 20 Pul available and a threshold-mode event "E7" priced 50 Pul',
  async ({ points }) => {
    await fund(points, 20);
    await pricedEvent(points, 50);
    state(points).before = await snapshot(points);
  },
);
When('the gating decision of "E7" is requested for "A"', async ({ points }) => {
  state(points).decision = await points.prices.gating(
    points.personId,
    state(points).items[0]!,
  );
});
Then(
  'it is "short" with a shortfall of 30 and no row is written to the journal or the ledger',
  async ({ points }) => {
    expect(state(points).decision).toMatchObject({
      decision: "short",
      shortfall: 30,
    });
    expect(await snapshot(points)).toEqual(state(points).before);
  },
);
When('"A" registers for "E7"', async ({ points }) => {
  await register(points, state(points).items[0]!);
});
Then(
  'the registration is refused with problem "points-threshold-short" and the same shortfall of 30',
  async ({ points }) => {
    expect(state(points).refused).toMatchObject({
      problem: "points-threshold-short",
      short: { shortfall: 30 },
    });
    expect(state(points).decision!.shortfall).toBe(30);
    await noFact(points, state(points).facts[0]!);
    expect(await snapshot(points)).toEqual(state(points).before);
  },
);

Given('"A" has 50 Pul available', async ({ points }) => {
  await fund(points, 50);
});
When(
  '"A" registers for two threshold-mode events priced 50 Pul at the same instant',
  async ({ points }) => {
    const receipt =
      process.env.E2E_POINTS_OVERLAP_REPORT ?? process.env.E2E_POINTS_OPS_LOG;
    if (!receipt)
      throw new Error(
        "E2E_POINTS_OVERLAP_REPORT must name the overlap receipt",
      );
    const facts = [];
    for (let index = 0; index < 2; index += 1)
      facts.push(signUp(points, await pricedEvent(points, 50)));
    const coordinator = createDrizzle(process.env.DATABASE_URL!, { max: 1 });
    const client = await coordinator.pool.connect().catch(async (error) => {
      await coordinator.pool.end();
      throw error;
    });
    let pending: Promise<PromiseSettledResult<unknown>[]> | undefined;
    const query = async (sql: string, params?: unknown[]) => {
      pointsOperation(sql);
      return client.query(sql, params);
    };
    try {
      await query("BEGIN");
      const coordinatorPid = (await query("SELECT pg_backend_pid() AS pid"))
        .rows[0]!.pid as number;
      await query(
        "SELECT id FROM points_accounts WHERE subject_kind='person' AND subject_id=$1 FOR UPDATE",
        [points.personId],
      );
      pending = Promise.allSettled(
        facts.map((fact) => points.engine.record(fact)),
      );
      let waiters: {
        pid: number;
        blockers: number[];
        wait_event_type: string;
        query: string;
      }[] = [];
      await expect
        .poll(
          async () => {
            waiters = (
              await points.handle.pool.query(
                `SELECT pid, pg_blocking_pids(pid) AS blockers, wait_event_type, query
        FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1
        AND state='active' AND wait_event_type='Lock' ORDER BY pid`,
                [points.applicationName],
              )
            ).rows;
            const reachesCoordinator = (
              pid: number,
              seen = new Set<number>(),
            ): boolean => {
              if (pid === coordinatorPid) return true;
              if (seen.has(pid)) return false;
              seen.add(pid);
              return (
                waiters
                  .find((row) => row.pid === pid)
                  ?.blockers.some((blocker) =>
                    reachesCoordinator(blocker, seen),
                  ) ?? false
              );
            };
            return waiters.filter((row) => reachesCoordinator(row.pid)).length;
          },
          { timeout: 3000, intervals: [25, 50, 100] },
        )
        .toBe(2);
      expect(waiters).toHaveLength(2);
      appendFileSync(
        receipt,
        JSON.stringify({
          phase: "overlap-before-release",
          database: process.env.E2E_POINTS_DATABASE,
          applicationName: points.applicationName,
          coordinatorPid,
          waiters: waiters.map(({ pid, blockers, wait_event_type }) => ({
            pid,
            blockers,
            wait_event_type,
          })),
          factIds: facts.map((fact) => fact.eventId),
        }) + "\n",
      );
      await query("COMMIT");
      state(points).outcomes = await pending;
    } finally {
      try {
        await query("ROLLBACK");
      } finally {
        if (pending) await pending;
        client.release();
        await coordinator.pool.end();
      }
    }
  },
);
Then(
  'exactly one reserve is posted and the other is refused with problem "points-threshold-short"',
  async ({ points }) => {
    const outcomes = state(points).outcomes!;
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    const loser = outcomes.findIndex(
      (outcome) => outcome.status === "rejected",
    );
    expect(loser).toBeGreaterThanOrEqual(0);
    expect(outcomes[loser]).toMatchObject({
      status: "rejected",
      reason: { problem: "points-threshold-short", short: { shortfall: 50 } },
    });
    const winner = 1 - loser;
    expect(outcomes[winner]).toMatchObject({
      status: "fulfilled",
      value: { outcome: "applied" },
    });
    await noFact(points, state(points).facts[loser]!);
    const after = await snapshot(points);
    expect(after.holds).toHaveLength(1);
    expect(after.holds[0]).toMatchObject({
      state: "held",
      price: 50,
      balance_part: 50,
      registration_id: state(points).facts[winner]!.attributes.registrationId,
    });
    expect(
      (
        await points.handle.pool.query(
          "SELECT event_id, amount, leg FROM points_postings WHERE event_id LIKE $1 || '#%'",
          [state(points).facts[winner]!.eventId],
        )
      ).rows,
    ).toEqual([
      {
        event_id: `${state(points).facts[winner]!.eventId}#spend.reserve`,
        amount: 50,
        leg: "reserve:balance",
      },
    ]);
  },
);
Then('"A" never has less than 0 Pul available', async ({ points }) => {
  const account = await points.ledger.readPersonAccount(points.personId);
  expect(account.pul).toEqual({ unit: "Pul", available: 0, reserved: 50 });
  // The committed posting prefixes, including funding, must never overdraw (025 EARS-22).
  const prefixes = (
    await points.handle.pool.query(
      `SELECT sum(CASE WHEN p.credit_account_id=a.id THEN p.amount ELSE -p.amount END)
    OVER (ORDER BY p.recorded_at, p.event_id, p.leg) AS available
    FROM points_postings p JOIN points_accounts a ON a.id IN (p.debit_account_id,p.credit_account_id)
    WHERE a.subject_kind='person' AND a.subject_id=$1 AND p.denomination='pul'`,
      [points.personId],
    )
  ).rows;
  expect(prefixes).not.toHaveLength(0);
  for (const row of prefixes)
    expect(Number(row.available)).toBeGreaterThanOrEqual(0);
  appendFileSync(
    (process.env.E2E_POINTS_OVERLAP_REPORT ?? process.env.E2E_POINTS_OPS_LOG)!,
    JSON.stringify({
      phase: "committed-outcome",
      database: process.env.E2E_POINTS_DATABASE,
      applicationName: points.applicationName,
      outcomes: state(points).outcomes!.map((value) =>
        value.status === "fulfilled"
          ? { status: value.status }
          : {
              status: value.status,
              problem: (value.reason as { problem: string }).problem,
            },
      ),
      pul: account.pul,
      committedPrefixes: prefixes.map((row) => Number(row.available)),
    }) + "\n",
  );
});
