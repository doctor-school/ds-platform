---
description: Release a main SHA to prod — dispatch deploy-prod.yml on the owner's word, poll and verify it, roll back with its rollback mode; pnpm deploy:prod is break-glass only.
---

# /deploy — production release runbook

Typing `/deploy` means: **read the `run-prod-deploy` catalog skill now and execute it.** That skill —
[`apps/docs/content/skills/run-prod-deploy/SKILL.md`](../../apps/docs/content/skills/run-prod-deploy/SKILL.md) — is the **single canonical, authoritative source** of the prod release procedure: the readiness checklist and pre-flight reads, the `deploy-prod.yml` dispatch on the owner's word, polling and verification (Deployment record, `/v1/health`, digest), the rollback mode, and break-glass `pnpm deploy:prod`. This file is only a thin entry pointer; it deliberately restates **no** step detail (that duplication is the drift this pattern avoids — "the path is the contract", AGENTS.md).
