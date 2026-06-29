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

| Seam env var          | Replaces                                   | Used by                                                                                                                   |
| --------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `LINT_FIXTURE_ROOT`   | the repo root the guard scans (FS)         | interaction-states, form-error, form-rhythm, ears-naming, ears-test, no-stub, asset-format, spec-link, instruction-budget |
| `LINT_GH_FIXTURE_DIR` | `gh pr/issue view` (canned JSON)           | registry-research, spec-link                                                                                              |
| `LINT_MEMORY_FILE`    | the derived `~/.claude/.../MEMORY.md` path | instruction-budget                                                                                                        |
| _(args)_              | CLI flags (`runGuard(..., { extraArgs })`) | —                                                                                                                         |

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

Covered here (FS / gh / memory seams): `interaction-states`, `form-error`,
`form-rhythm`, `ears-naming`, `ears-test`, `no-stub`, `asset-format`,
`registry-research`, `spec-link`, `instruction-budget`.

The EARS pair is the bidirectional EARS↔test contract (#316): `ears-test`
(coverage + orphan; a pure WARN nudge, so its cases assert the stdout warning
text rather than an exit code) and `ears-naming` (format hygiene; exit-code
cases for a malformed `EARS-…` prefix).

**Also here (direct import, not a lint guard):**
`agent-bootstrap-recommend.spec.ts` unit-covers the pure `recommend()` of
[`tools/agent-bootstrap.ts`](../../agent-bootstrap.ts) (#306) — its only
side-effect-free seam (the script guards `main()` behind an entry-point check so
the import fires no `gh`/`git` subprocess). It rides this package's `vitest run`
because `tools/` has no test workspace of its own; the assertion that an empty
ready/working/awaiting bucket set with open issues yields a _triage_ nudge (never
"clean slate") is the deterministic backstop the #306 retro asked for.

`agent-bootstrap-concurrency.spec.ts` + `task-worktree.spec.ts` unit-cover the
parallel-session detector (#359): the pure `liveParallelSessions()` (mtime
window, self-exclusion, shared-main-tree breakdown), `isSharedMainTree()`, and
`encodeProjectSlug()` of [`tools/agent-bootstrap.ts`](../../agent-bootstrap.ts),
plus the slug/prefix/path derivation of
[`tools/dev/task-worktree.mjs`](../../dev/task-worktree.mjs) (`pnpm
task:worktree`). Same entry-point-guard discipline — the import fires no
`git`/`gh` subprocess.

**`endpoint-authz` is covered in `apps/api`, not here.** It boots Nest (needs
`@nestjs/*`, runs in the `api-e2e` job), so the Nest-boot strategy lives where
the dependency does:

- `apps/api/src/authz/authz.discovery.spec.ts` — `collectAuthzRows()` over a
  fixture Nest module: green (well-classified routes, no violation), red-missing
  (unclassified handler → violation), red-invalid (present-but-broken `@Authz`
  on the validity path).
- `apps/api/src/authz/authz.matrix.spec.ts` — the pure `validateRow()` /
  `renderMatrix()` / `assembleEndpoint()` logic (every §6.2 / §3.1 branch).

Together these assert the gate's scan + validity behaviour against a real boot;
the thin `endpoint-authz-lint.ts` CLI shell (argv / drift / `--generate`) is I/O
glue over that tested logic.

**Stub guards:** `tdd-signal`, `events`, `prior-decisions`, `module-readme`, the
glossary pair, and `spec-status` are `[stub]` (exit 0, no checks) — no fail branch
to assert yet. Each gets coverage when it grows real behaviour, on its own
implementation Issue. (`ears-test` grew its coverage + orphan behaviour in #316
and is now covered above via stdout assertions.)
