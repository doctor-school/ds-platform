---
"@ds/schemas": major
"@ds/api": major
"@ds/api-client": major
---

The 025 universal rule engine core (#3838; EARS-3, 4, 25 amended; EARS-32…40, 42, 44): rules and settings become data. A developer-registered fact-type catalog with typed attributes and predicates, one rule body schema (trigger, condition AST, `credit` / `debit` effect, limits `oncePer` / `countPer` / `unlimited`, validity window, stacking), and `PointsEngine.record(fact)` — a producer reports what happened; every matching rule version active at `occurredAt` is evaluated, written as one ledger fact `<event id>#<rule id>`, and journaled in `points_facts` with its full evaluation trace. A `countPer` scope is serialised by a transaction-scoped advisory lock, so concurrent facts never exceed the cap. Migration 0060 adds the engine columns, the journal and the PRD seed at the epoch, each seeded id numbered `max(version) + 1`. Spend effects (reserve / settle / release, price-list debit, `concurrentOpen`) wait for #3810 and are refused at publish.

**Breaking:**

- `@ds/api` / `@ds/api-client`: `POST /v1/admin/points/rules/:ruleId/versions` takes the one rule body (`parameters` = a `rule` or `setting` body) for any admin slug, answers `PublishedPointsRuleVersion` (with `kind` and stacking `warnings`), refuses a retired 0059 id with 422 `points-rule-retired`; `points-rule-unknown` (404) is gone.
- `@ds/api`: `PointsFactIntake` (`accept` / `acceptWithin`) is removed — producers call `PointsEngine.record`.
- `@ds/schemas`: the error code `POINTS_RULE_UNKNOWN` is removed (`POINTS_PHONE_UNVERIFIED`, `POINTS_RULE_RETIRED` added); the publish request and response schemas follow the one rule body.
