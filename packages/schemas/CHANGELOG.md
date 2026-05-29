# @ds/schemas

## 0.2.0

### Minor Changes

- [#62](https://github.com/doctor-school/ds-platform/pull/62) [`275d575`](https://github.com/doctor-school/ds-platform/commit/275d575a0a5878c8a077146971b6e4cc7ce88d11) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(api): GET /v1/ready with Postgres + pgvector probes

  Adds a readiness endpoint that probes Postgres (`SELECT 1`) and the pgvector
  extension (`to_regtype('vector')`) via `Promise.allSettled`, returning a
  Zod-validated body (HTTP 200 when both pass, HTTP 503 — same shape — when any
  probe fails). `@ds/schemas` gains `ReadinessResponseSchema` + `CheckStatusSchema`
  (reusable building block for future Redis/MinIO/Centrifugo probes). Closes [#60](https://github.com/doctor-school/ds-platform/issues/60).

## 0.1.0

### Minor Changes

- [#9](https://github.com/doctor-school/ds-platform/pull/9) [`1fa06ec`](https://github.com/doctor-school/ds-platform/commit/1fa06eccfbb41aae1b0de016f2012874b07a3f9e) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Bootstrap `apps/api` (NestJS 11 + Fastify + nestjs-zod, ESM, Node 22) with the first endpoint `GET /v1/health` returning `{ status: 'ok', uptime, timestamp }` via `VersioningType.URI`. Bootstrap `packages/schemas` from stub to host `HealthResponseSchema` — the first Zod entry in the API SSOT (ADR-0002 §3, ADR-0006 §6.2).
