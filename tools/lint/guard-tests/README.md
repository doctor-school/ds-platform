# `@ds/lint-guard-tests` — exit-code harness for the AI-discipline lint guards

Each spec spawns the **real** `tools/lint/*.ts` guard as a subprocess (via
`pnpm exec tsx`) and asserts its exit code (`0` pass / `1` fail) plus a stable
substring of the message. No mock of the guard — the production code path runs.
Runs in CI inside the `unit` job (`turbo run test`); no dedicated CI job.

Harness entry points live in [`run-guard.ts`](./run-guard.ts): `runGuard`,
`caseDir`, `ghDir`.

## Test seams

A guard can only be driven deterministically if its inputs are injectable. The
guards expose four seams, each inert in production (the env var is unset, so the
guard resolves real paths / spawns real `gh` exactly as before):

| Seam env var          | Replaces                                   | Used by                                                                  |
| --------------------- | ------------------------------------------ | ------------------------------------------------------------------------ |
| `LINT_FIXTURE_ROOT`   | the repo root the guard scans (FS)         | interaction-states, no-stub, asset-format, spec-link, instruction-budget |
| `LINT_GH_FIXTURE_DIR` | `gh pr/issue view` (canned JSON)           | registry-research, spec-link                                             |
| `LINT_MEMORY_FILE`    | the derived `~/.claude/.../MEMORY.md` path | instruction-budget                                                       |
| _(args)_              | CLI flags (`runGuard(..., { extraArgs })`) | —                                                                        |

`LINT_FIXTURE_ROOT` is set to the case dir automatically by `runGuard`; the rest
are passed per case via `runGuard(guard, caseDir, { env })`.

## Fixture layout

```
fixtures/<guard>/<case>/                 ← LINT_FIXTURE_ROOT (FS-scan guards)
fixtures/<guard>/<case>/gh/              ← LINT_GH_FIXTURE_DIR  (ghDir helper)
   pr-view-<n>.json                      ←   gh pr view <n> --json …
   issue-view-<n>.json                   ←   gh issue view <n> --json …
fixtures/<guard>/<case>/memory/MEMORY.md ← LINT_MEMORY_FILE (instruction-budget)
```

Each guard's spec ships a **green** case and one **red case per failure branch**,
plus skip cases (non-PR event, no-UI-touch, no-feature-label) where the guard has
an early exit-0 path. Red cases isolate a single failing input (the others kept
valid) so the asserted message maps to one branch.

## Coverage

Covered (FS / gh / memory seams): `interaction-states`, `no-stub`,
`asset-format`, `registry-research`, `spec-link`, `instruction-budget`.

**Not here:** `endpoint-authz` boots the real Nest `AppModule`, so its harness
lives in `apps/api` (it needs `@nestjs/*` and runs in the `api-e2e` job) — tracked
on #293. The `[stub]` guards (`tdd-signal`, `events`, `prior-decisions`,
`module-readme`, glossary pair, `spec-status`) and the permanent-WARN
`ears-test` have no fail branch to assert yet; each gets coverage when it grows
real behaviour, on its own implementation Issue (#293 scope note).
