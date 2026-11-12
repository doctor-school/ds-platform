import assert from "node:assert/strict";

export interface StoredRule extends Record<string, unknown> {
  rule_id: string;
  version: number;
  kind: string;
  parameters: Record<string, unknown>;
  trigger_fact_types: string[];
  effective_from: string | Date;
  published_by: string | null;
}
export interface RuleAudit extends Record<string, unknown> {
  id: string;
  event_type: string;
  metadata: Record<string, unknown>;
}
export interface RuleHistory {
  rules: StoredRule[];
  audits: RuleAudit[];
}
export interface NativePublicationReceipt {
  row: StoredRule;
  audit: RuleAudit;
  startedAt: string;
  finishedAt: string;
}
export interface SeedHistoryReceipt {
  ruleId: string;
  actorId: string;
  actorSub: string;
  actor: { id: string; zitadel_sub: string; role: string };
  before: RuleHistory;
  after: RuleHistory;
  publications: NativePublicationReceipt[];
  financialBefore: Record<string, unknown[]>;
  financialAfter: Record<string, unknown[]>;
  pricesBefore: unknown[];
  pricesAfter: unknown[];
}
export interface SeedChange {
  ruleId: string;
  version: number;
  body: Record<string, unknown>;
  changedBody: Record<string, unknown>;
}
const json = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const orderedRules = (rows: StoredRule[]) =>
  [...rows].sort(
    (a, b) => a.rule_id.localeCompare(b.rule_id) || a.version - b.version,
  );
const orderedAudits = (rows: RuleAudit[]) =>
  [...rows].sort((a, b) => a.id.localeCompare(b.id));

export function assertSeedHistoryTransition(
  value: SeedHistoryReceipt,
  seed: SeedChange,
): void {
  assert.equal(value.ruleId, seed.ruleId, "Wrong seed identity");
  assert(value.actorId && value.actorSub, "Missing publishing actor");
  assert.equal(
    value.actor.id,
    value.actorId,
    "Wrong native publishing identity",
  );
  assert.equal(
    value.actor.zitadel_sub,
    value.actorSub,
    "Wrong native publishing identity",
  );
  assert(
    typeof value.actor.role === "string" && value.actor.role.length > 0,
    "Missing native user mirror role",
  );
  assert.equal(
    value.publications.length,
    2,
    "Expected change and forward restoration receipts",
  );
  const old = value.before.rules.filter((row) => row.rule_id === seed.ruleId);
  assert(old.length > 0, "Missing original seed history");
  const previous = orderedRules(old).at(-1)!;
  assert.equal(
    previous.version,
    seed.version,
    "Literal original seed version is not fresh",
  );
  assert.deepEqual(
    json(previous.parameters),
    json(seed.body),
    "Wrong initial default body",
  );
  assert.equal(
    new Date(previous.effective_from).getTime(),
    0,
    "Wrong seed provenance",
  );
  assert.equal(previous.published_by, null, "Wrong seed publisher");

  const bodies = [seed.changedBody, seed.body];
  for (const [index, publication] of value.publications.entries()) {
    const { row, audit } = publication;
    assert.equal(row.rule_id, seed.ruleId, "Wrong publication identity");
    assert.equal(
      row.version,
      seed.version + index + 1,
      "Wrong forward version",
    );
    assert.equal(row.published_by, value.actorId, "Wrong publication actor");
    assert.equal(row.kind, seed.body.kind, "Changed seed kind");
    assert.deepEqual(
      json(row.parameters),
      json(bodies[index]),
      "Wrong changed/default body",
    );
    assert.deepEqual(
      row.trigger_fact_types,
      bodies[index]!.kind === "rule" ? bodies[index]!.trigger : [],
      "Wrong publication triggers",
    );
    const effective = new Date(row.effective_from).getTime();
    const started = Date.parse(publication.startedAt);
    const finished = Date.parse(publication.finishedAt);
    assert(
      Number.isFinite(effective) &&
        started <= effective &&
        effective <= finished,
      "Publication backdated or outside native call",
    );
    if (index > 0)
      assert(
        effective >=
          new Date(value.publications[index - 1]!.row.effective_from).getTime(),
        "Restoration predates change",
      );
    assert(audit.id, "Missing publication audit identity");
    assert.equal(
      audit.event_type,
      "data.points_rule_versions.insert",
      "Wrong audit event",
    );
    assert.equal(audit.subject_id, null, "Wrong direct-service audit subject");
    assert.equal(
      audit.metadata.source,
      "db-direct",
      "Wrong native audit source",
    );
    assert.equal(
      audit.metadata.table,
      "points_rule_versions",
      "Wrong audit table",
    );
    assert.deepEqual(
      audit.metadata.pk,
      { rule_id: seed.ruleId, version: row.version },
      "Wrong audit publication identity",
    );
    const diff = audit.metadata.diff as Record<string, { new?: unknown }>;
    assert.deepEqual(
      json(diff?.parameters?.new),
      json(row.parameters),
      "Audit body differs",
    );
    assert.equal(
      diff?.published_by?.new,
      value.actorId,
      "Audit publisher differs",
    );
  }
  assert.equal(
    new Set(value.publications.map((p) => p.audit.id)).size,
    2,
    "Repeated audit receipt",
  );
  assert.deepEqual(
    json(orderedRules(value.after.rules)),
    json(
      orderedRules([
        ...value.before.rules,
        ...value.publications.map((p) => p.row),
      ]),
    ),
    "Seed history changed outside exact publications",
  );
  assert.deepEqual(
    json(orderedAudits(value.after.audits)),
    json(
      orderedAudits([
        ...value.before.audits,
        ...value.publications.map((p) => p.audit),
      ]),
    ),
    "Audit history changed outside exact publications",
  );
  for (const table of [
    "accounts",
    "journal",
    "keys",
    "postings",
    "holds",
    "obligations",
  ]) {
    assert(
      Array.isArray(value.financialBefore[table]) &&
        Array.isArray(value.financialAfter[table]),
      "Missing financial snapshot",
    );
  }
  assert.deepEqual(
    json(value.financialAfter),
    json(value.financialBefore),
    "Cleanup changed financial history",
  );
  assert(
    Array.isArray(value.pricesBefore) && Array.isArray(value.pricesAfter),
    "Missing prices snapshot",
  );
  assert.deepEqual(
    json(value.pricesAfter),
    json(value.pricesBefore),
    "Cleanup changed prices",
  );
}
