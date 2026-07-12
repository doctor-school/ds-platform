# `@ds/observability`

The DS Platform **shared observability layer** — the common tracing / metrics /
logging wiring (OpenTelemetry → Tempo/Prometheus/Loki, GlitchTip errors) that
services import so telemetry is configured once, not per app. The defaults are set
by the engineering-readiness spec.

## Status — reserved scaffold

This is a **reserved workspace slot**: the package currently holds only its
`package.json` (name `@ds/observability`, `private`). The shared instrumentation
helpers land as the observability stack is wired in. Until then `@ds/api` carries
its telemetry wiring inline (`apps/api/src/observability/`).

## Public surface

_None yet_ — the shared init/instrumentation exports arrive when populated.

## Build / test

No package-local scripts yet; type-checked/tested through the workspace root
(`pnpm typecheck` / `pnpm test`, `turbo run`).

## Owning spec

- **Engineering-readiness design** —
  `apps/docs/content/specs/tech/2026-05-12-engineering-readiness-design-en.md`
  (Loki / Prometheus / Tempo / GlitchTip defaults).
