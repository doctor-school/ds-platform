<!-- Auto-loaded reference (no `paths:` frontmatter ⇒ always-on). Detail behind AGENTS.md §9. -->

# Local Dev Stand (reference)

Canon: AGENTS.md §9 one-liner. Applies to any dev-stand operation, migration, or live UI verification.

The stand (Postgres, Redis, MinIO, `idp`, Centrifugo, Cerbos, Mailpit) runs as a Docker Compose stack — a two-layer model: portable contract in git (`infra/dev-stand/compose.core.yml`, `.env.example`, README) + per-developer recipe outside git (`.env.local`, `compose.override.yml`). The rules below are portable — they hold on every recipe; recipe-specific endpoints/paths/failure modes live in the developer's personal `~/.ds-platform/AGENT_NOTES.md`, never in repo files.

Full design: [`local-dev-environment-setup-design`](../../apps/docs/content/specs/tech/2026-05-18-local-dev-environment-setup-design-en.md) (§8 AI-agent integration). Bootstrap checklist, DX cheat sheet, container-isolation rules: [`infra/dev-stand/README.md`](../../infra/dev-stand/README.md). Recipe + recovery: memory `reference_ds_platform_dev_stand_recipe`; local api+portal live-run: memory `reference_local_api_portal_live_run_recipe`.

## Endpoints — read from `.env.local`, never hardcode

Service endpoints (`DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`, `CENTRIFUGO_URL`, `CERBOS_URL`, `IDP_ISSUER`, `SMTP_HOST`…) are recipe-specific, in `~/.ds-platform/.env.local`. Read them from there (or the running process env) — NEVER hardcode a host or port in code, specs, or instruction files; the `HOST` differs per recipe (`truenas.local`, `localhost`, a cloud VM…).

Stage-B handback URLs, sharpened: every service URL handed to the owner is resolved from `.env.local` / `dev:status` and curl-probed by the lead before handoff — the owner is never the first to open it. Only api/portal are `localhost`; docker-stand services (Mailpit/Zitadel/Postgres/…) sit on the recipe HOST. Procedure: `build-ui-from-design-system` → Stage B.

## DX commands

Driven by `pnpm dev:*` (env-driven launcher `tools/dev/run.mjs`): reads `.env.local`, picks the transport, runs `docker compose`. Cheat sheet (`dev:up`/`down`/`status`/`logs`/`restart`/`psql`/`snapshot`/`rollback`/`reset-db`/`config`): [`infra/dev-stand/README.md` → DX commands](../../infra/dev-stand/README.md#dx-commands).

## Rules for agents

- **Snapshot before migrate.** Before `pnpm drizzle:migrate`, ALWAYS `pnpm dev:snapshot pre-mig-<short-desc>` first. The wrapper chains this automatically; a manual migration or raw `drizzle-kit migrate` bypasses it — snapshot by hand.
- **Never edit files inside volumes.** Volumes (Postgres `pgdata`, Redis dumps, MinIO buckets) hold live data — no direct edit/copy/`rm`; go through the service (`psql`, an S3 client) or snapshot/rollback. A direct write to a live `pgdata` corrupts the database.
- **Shared-stand discipline (subagents + self).** `dev:reset-db` nukes the Postgres volume → Zitadel re-inits → every `IDP_*` cred goes stale, auth breaks for ALL sessions. So: (1) any subagent brief with stand/DB access MUST forbid `dev:reset-db` and raw destructive `dev:psql` — the only sanctioned migration recovery is transactional `drizzle:migrate` + `dev:snapshot`/`dev:rollback`; (2) such a brief MUST also require the subagent to append every stand-touching command (`dev:*`, `psql`/raw SQL, process kills, port binds) to a machine-parseable log it creates (`<its scratchpad>/stand-ops-<task>.log`, one command per line), and the lead audits by grepping THAT file after return — a self-report reply is a flagged fallback only (a destructive op can be silently omitted; transcript `.output` files can be 0 bytes); a clean diff ≠ shared state intact; (3) self-inflicted shared-stand breakage is restored in the same session before the result/wrap — never deferred.
- **LAN endpoints are trusted, not egress.** Stand services are intra-zone LAN endpoints (setup-design §8.3) — do NOT route stand traffic through the egress PII scanner (ADR-0011).
- **No source code on the remote Docker host.** Only volumes live on a remote box; `apps/*` and `packages/*` stay on the developer's local NVMe.
- **The dev box is not 24/7.** TrueNAS is power-cycled — schedule tasks uptime-relative (boot-triggered + age check), never fixed-time cron.
- **Playwright payloads stay out of the lead's context.** Interactive browser verification (MCP playwright) runs inside a dispatched subagent; the lead receives only the verdict + screenshot paths (return contract: CLAUDE.md → Subagent context economy). For repeatable checks prefer a scripted Playwright spec (`@playwright/test` is a dependency of `apps/portal` / `apps/showcase`) printing a compact pass/fail.
- **Live-verify pre-flight is yours to run.** Confirm the stand is up (`pnpm dev:status`), bring it up (`pnpm dev:up`) if needed — a down stand is expected, not a blocker to hand back. Never ask the user "is the dev box on?" — check `dev:status` and follow the failure table.
- **A subagent-booted stand belongs to the task, and stays killable by the lead.** No auto-restart/relauncher watchers or "kill-proof" self-healing — a subagent's processes stay killable by port, and on completion or an «отбой» it kills its own PIDs and never resurrects them. A persistent owner Stage-B stand is lead-booted from the start — a subagent serves only the ephemeral build+proof (listeners reaped on exit). Canon: `build-ui-from-design-system` → Stage B.

## Parallel sessions — ports + branch databases

The `api :3000` / `portal :3001` pair is the single-session default only. Sessions run concurrently (AGENTS.md §6); ports and the dev database are shared resources:

- **Probe, don't reuse.** Run `pnpm dev:ports` — binds-and-releases to find the first free pair (3000/3001, then 3100/3101, …) and prints the `API_PORT`/`PORTAL_PORT` lines. Never bind the default blindly.
- **Never kill a listener you did not start.** A foreign `localhost` server is likely another session's Stage-B live-review URL, which MUST stay up until the owner's verdict (AGENTS.md §6) — killing it is forbidden. (Overrides the single-session "KILL stale listeners first" step, which applies only to your own stale listeners on your own pair.)
- **Record the chosen pair** in the Stage-B handoff and the Issue's stop-state comment — the owner opens the right URL; the next session knows which pairs are taken.
- **Stage-B owner stands — ONE canonical home.** Production-build serve (never `next dev`), logged-in URL drive before handoff, liveness re-check on reap-prone pairs, still-live handback with a recorded relaunch recipe: [`build-ui-from-design-system`](../../apps/docs/content/skills/build-ui-from-design-system/SKILL.md) → Stage B — read it before any owner handoff. The port/DB rules here apply to those stands too.
- **Branch worktree → branch database.** `pnpm dev:db:branch <issue-N>` creates + migrates `ds_dev_<n>` in the shared Postgres container and prints the `DATABASE_URL` to export for that session's api (session env only — never edit `~/.ds-platform/.env.local`). Broken branch DB → `pnpm dev:db:drop <N>` + re-`db:branch`, never a global rollback. `dev:rollback` rewinds the whole dataset — every branch DB at once — so with parallel sessions live it is coordination-gated (announce + ack on the board first). Zitadel/Redis/MinIO stay shared. Detail: `infra/dev-stand/README.md` → DX commands → Parallel sessions.

## Baseline failure modes

- Stack not running / service down → `pnpm dev:status`, then `pnpm dev:logs <service>` / `pnpm dev:restart <service>`.
- Endpoint unreachable → verify the value in `.env.local`; confirm the service is up via `dev:status`.
- Host port already in use → inspect listening ports (`netstat` / `ss`); remap the host-side port in the recipe override.
- `*.local` host does not resolve → mDNS failure, fall back to the static IP; recipe-specific causes + the static IP: developer's `AGENT_NOTES.md` and `infra/dev-stand/README.md` → Bootstrap checklist.
