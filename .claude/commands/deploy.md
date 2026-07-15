---
description: Ship origin/main to prod — the manual `pnpm deploy:prod` runbook, record cycle, health verify, and app-only rollback.
---

# /deploy — production deploy runbook

Typing `/deploy` means: **read the `run-prod-deploy` catalog skill now and execute it.** That skill —
[`apps/docs/content/skills/run-prod-deploy/SKILL.md`](../../apps/docs/content/skills/run-prod-deploy/SKILL.md) — is the **single canonical, authoritative source** of the prod deploy procedure: preconditions (clean tree · ff-only `main` · green CI), the `pnpm deploy:prod` pipeline, the record cycle it triggers (GitHub Deployment + release tag/Release + Mattermost digest, all non-fatal), health verify, and `--rollback`. This file is only a thin entry pointer; it deliberately restates **no** step detail (that duplication is the drift this pattern avoids — "the path is the contract", AGENTS.md).
