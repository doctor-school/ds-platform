## What & why

Tightens the #940 `AskUserQuestion` calibration hook (`tools/hooks/askuserquestion-calibration-guard.mjs`) with two additional non-blocking WARN advisories it previously missed. Both are additive and consistent with the existing WARN mechanism — the hook still never blocks (exit 0, `permissionDecision: "allow"`, fail-open).

**(a) Restore / remediation-scope framed as an owner menu.** Restoring an erroneously deleted/broken artifact is a LEAD call (minimal-diff, faithful, FULL restore), not an owner scope selection. Fires when a single copy string pairs a restore/remediation verb (RU `восстанов/восстанав`, `откат`, `вернуть/вернём/верни`; EN `restore/undo/revert/re-instate/rollback/remediate`) with a scope/extent cue (`объём/scope/только/весь/целиком/полностью/частично/only/whole/entire/extent`). Same-string pairing keeps it conservative — a password-recovery flow that merely says «восстановление» in the question with an unrelated «только» in an option does **not** fire.

**(b) An option/question asserting an unverified live-surface state claim.** Such a claim must be verified against source first (the «сегодняшний /account — это сырой debug-дамп» incident). Fires when a single copy string pairs a surface reference (a `/route`, a source filename, or a surface noun `страница/page/endpoint/route/маршрут/экран/screen`) with an asserted-state predicate (`is/returns/renders/является/содержит` or a loaded state-noun `dump/дамп/stub/заглушк/сырой`). Kept tight — a "which page to route to?" product pick (surface noun, no assertion) does not fire.

Both real-incident strings are embedded as fixtures. RU and EN framings are covered. Regression fixtures prove the legitimate owner taste / product-scope questions the gate already permits still pass clean (accent-colour pick, password-recovery flow naming, page-routing pick).

Implementation notes: JS `\b` is ASCII-only, so RU regex cues deliberately omit `\b`; bare `это` is excluded as a predicate (indistinguishable from the demonstrative «этой/этот»).

## Testing

- `tools/lint/guard-tests/askuserquestion-calibration-guard.spec.ts` — 29 passed (new restore-scope, live-surface, and no-regression cases incl. spawned end-to-end + pure-seam).
- Full `@ds/lint-guard-tests` suite — 917 passed.
- `pnpm pr:preflight --static` — 25 guards pass.
- eslint on both changed files — clean.

Closes #976

registry-research: n/a (no app UI touched — tooling hook + its vitest spec only)

## Product note (RU)

n/a — внутренний tooling-хук (advisory-калибровка `AskUserQuestion`), пользовательской поверхности не затрагивает.

author:claude
