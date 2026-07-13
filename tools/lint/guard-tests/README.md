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

| Seam env var          | Replaces                                   | Used by                                                                                                                                                                                                      |
| --------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `LINT_FIXTURE_ROOT`   | the repo root the guard scans (FS)         | interaction-states, form-error, form-rhythm, ears-naming, ears-test, no-stub, asset-format, spec-link, instruction-budget, events-drift, glossary-mdx, glossary-roundtrip, frontmatter-yaml, migration-index |
| `LINT_GH_FIXTURE_DIR` | `gh pr/issue view` (canned JSON)           | registry-research, spec-link                                                                                                                                                                                 |
| `LINT_MEMORY_FILE`    | the derived `~/.claude/.../MEMORY.md` path | instruction-budget                                                                                                                                                                                           |
| _(args)_              | CLI flags (`runGuard(..., { extraArgs })`) | —                                                                                                                                                                                                            |

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
`registry-research`, `spec-link`, `instruction-budget`, `module-readme`,
`tdd-signal`, `spec-status`, `prior-decisions`, `events-drift`, `glossary-mdx`,
`glossary-roundtrip`, `frontmatter-yaml`, `migration-index`.

`migration-index` (#799) is an FS-scan guard against the parallel-branch Drizzle
migration-index collision (two branches generate the same next `NNNN`; on merge
one sibling's journal entry / snapshot is dropped). In fixture mode the
origin/main base journal is read from `<case>/origin-main/_journal.json`
(fixture-only file — git is never spawned against a fixture tree); in
production it comes from `git show origin/main:apps/api/drizzle/meta/_journal.json`
with a shallow-checkout fetch fallback, and an unobtainable base is a SKIP,
never a false red.

`frontmatter-yaml` (#597) is a FS-scan guard that parses every
`apps/docs/content/**/*.{md,mdx}` frontmatter block with **gray-matter**
(js-yaml under the hood — faithful for the malformed-frontmatter class
`docs-build` fails on) and fails with a `<file>:<line>` message on a
malformed block — the #596 class, where an unquoted `: ` inside a list entry
parses as a nested mapping and breaks the docs build. It runs in the
`pnpm pr:preflight` static family (on by default in PR-number mode since #633;
also via standalone `--static`) as the LOCAL pre-push mirror of the `docs-build`
CI job (no dedicated CI job of its own).

The last three grew real behaviour in #448 (they were exit-0 stubs, baseline
hard-red in the `ci` needs-list per #440). All three are FS-scan
(`LINT_FIXTURE_ROOT`): `events-drift` diffs `@OutboxEmit` call-sites against
`specs/**/events.md`; `glossary-roundtrip` diffs the glossary source id set
against the generated `packages/glossary/(src/)?ids.ts`; `glossary-mdx` resolves
`[[term-id]]` directives against the glossary source. Each ships a green case,
an empty/evaluated-emptiness case (events-drift, glossary-roundtrip) or scoping
cases (glossary-mdx cross-ref + code-span masking), the new-term opt-out
(glossary-mdx), and one red-per-branch. The glossary pair shares
[`lib/glossary.ts`](../lib/glossary.ts) (the canonical-id source reader).

The four #438 guards grew real behaviour then (they were exit-0 stubs). `module-readme`
is an FS-scan (`LINT_FIXTURE_ROOT`) with a `LINT_MODULE_README_ALLOW` env seam for
the grandfather-allowlist branch; `tdd-signal` / `spec-status` / `prior-decisions`
are PR-event-gated — their changed-file / label / status inputs come from the
`LINT_GH_FIXTURE_DIR` `gh pr view` seam, and their spec/tree reads from
`LINT_FIXTURE_ROOT`. Each ships green + one red-per-branch + skip cases.

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

`worktree-teardown.spec.ts` unit-covers the pure `resolveWorktreePath()` of
[`tools/dev/worktree-teardown.mjs`](../../dev/worktree-teardown.mjs) (`pnpm
worktree:teardown`, #598): a bare name resolves against the primary tree's
`.claude/worktrees/<name>` (mirroring `task:worktree`), while explicit
absolute/relative paths are honored as-given, with `root`/`exists` injected so
no `git` subprocess or real filesystem is touched.

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

**No stub guards remain.** `events-drift` and the glossary pair (`glossary-mdx`,
`glossary-roundtrip`) grew real behaviour in #448 (they were exit-0 stubs) and are
covered above; `ears-test` grew its coverage + orphan behaviour in #316; and
`tdd-signal` / `spec-status` / `prior-decisions` / `module-readme` grew theirs in
#438. Every guard that runs now asserts at least one exit-code branch here.
