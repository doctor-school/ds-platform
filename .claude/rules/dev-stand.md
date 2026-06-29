<!-- Auto-loaded reference (epic #247 / #250; no `paths:` frontmatter ⇒ always-on, in context every session).
     Relocated verbatim from AGENTS.md §9. -->

# Local Dev Stand (reference)

Canon: AGENTS.md §9 one-liner; this is the detail, auto-loaded with it. Applies to any dev-stand operation, migration, or live UI verification.

The local dev stand (Postgres, Redis, MinIO, `idp`, Centrifugo, Cerbos, Mailpit) runs as a Docker Compose stack. It is a **two-layer model** (setup-design §2.1): a portable contract in git (`infra/dev-stand/compose.core.yml`, `.env.example`, README) plus a per-developer recipe kept outside git (`.env.local`, `compose.override.yml`). The rules below are **portable** — they hold on every recipe. Recipe-specific endpoints, paths, and failure modes live in the developer's personal `~/.ds-platform/AGENT_NOTES.md`, never in repo files.

Full design: [`local-dev-environment-setup-design`](../../apps/docs/content/specs/tech/2026-05-18-local-dev-environment-setup-design-en.md) (§8 AI-agent integration). Bootstrap checklist, DX-command cheat sheet, and container-isolation rules: [`infra/dev-stand/README.md`](../../infra/dev-stand/README.md). Recipe + recovery detail: memory `reference_ds_platform_dev_stand_recipe`. Local api+portal live-run recipe: memory `reference_local_api_portal_live_run_recipe`.

## Endpoints — read from `.env.local`, never hardcode

Service endpoints (`DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`, `CENTRIFUGO_URL`, `CERBOS_URL`, `IDP_ISSUER`, `SMTP_HOST`…) are **recipe-specific** and live in the developer's `~/.ds-platform/.env.local`. Agents read them from there (or from the running process env) — they MUST NOT hardcode a host or port in code, specs, or instruction files. The `HOST` differs per recipe (`truenas.local`, `localhost`, a cloud VM…); a hardcoded endpoint silently breaks every other recipe.

## DX commands

The stack is driven by `pnpm dev:*` (env-driven launcher `tools/dev/run.mjs`, DSP-156): it reads `.env.local`, picks the transport, and runs `docker compose` against the stand. Full cheat sheet (`dev:up` / `down` / `status` / `logs` / `restart` / `psql` / `snapshot` / `rollback` / `reset-db` / `config`) with per-command behavior: [`infra/dev-stand/README.md` → DX commands](../../infra/dev-stand/README.md#dx-commands).

## Rules for agents

- **Snapshot before migrate.** Before `pnpm drizzle:migrate`, ALWAYS run `pnpm dev:snapshot pre-mig-<short-desc>` first. The `drizzle:migrate` wrapper chains this automatically (setup-design §9.2), but a manual migration or a raw `drizzle-kit migrate` call bypasses the wrapper — snapshot first by hand.
- **Never edit files inside volumes.** Container volumes (Postgres `pgdata`, Redis dumps, MinIO buckets) hold **live data**. Do not edit, copy over, or `rm` files inside them directly — go through the service (`psql`, an S3 client) or a snapshot/rollback. A direct write to a live `pgdata` corrupts the database.
- **Shared-stand discipline (subagents + self).** `dev:reset-db` nukes the whole Postgres volume → Zitadel re-inits fresh → every `IDP_*` cred goes stale and auth breaks for **all** sessions (detail: memory `feedback_subagent_never_reset_db`). So: (1) any subagent brief with stand/DB access **MUST forbid** `dev:reset-db` and raw destructive `dev:psql` — the only sanctioned migration recovery is transactional `drizzle:migrate` + `dev:snapshot`/`dev:rollback`; (2) after a stand/DB-touching subagent returns, **inspect its command trace for destructive stand ops before trusting its diff** (a clean diff ≠ shared state intact); (3) self-inflicted shared-stand breakage is restored in the **same session** before the result/wrap — never deferred to "the next live-verify".
- **LAN endpoints are trusted, not egress.** Dev-stand services are LAN endpoints — the LAN is classified as a trusted network (setup-design §8.3). Do NOT route stand traffic (e.g. `truenas.local`) through the egress PII scanner (ADR-0011); these are intra-zone calls.
- **No source code on the remote Docker host.** Only Docker volumes live on a remote box. `apps/*` and `packages/*` stay on the developer's local NVMe (setup-design §2.2).
- **The dev box is not 24/7.** TrueNAS is power-cycled — schedule any task uptime-relative (boot-triggered + age check), never fixed-time cron (memory `project_truenas_not_24_7`).
- **Live-verify pre-flight is yours to run.** Before any live UI verification, confirm the stand is up with `pnpm dev:status` and bring it up (`pnpm dev:up`) if needed — the box is power-cycled, so a down stand is expected, not a blocker to hand back. **Never ask the user "is the dev box on?"** — check `dev:status` and follow the failure table (memory `feedback_check_dev_stand_yourself`).

## Baseline failure modes

| Symptom                          | Check                                                                                                                                                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stack not running / service down | `pnpm dev:status`, then `pnpm dev:logs <service>` / `pnpm dev:restart <service>`.                                                                                                                                      |
| Endpoint unreachable             | Verify the value in `.env.local`; confirm the service is up via `dev:status`.                                                                                                                                          |
| Host port already in use         | Inspect listening ports (`netstat` / `ss`); remap the host-side port in the recipe override.                                                                                                                           |
| `*.local` host does not resolve  | mDNS failure — fall back to the static IP. Recipe-specific causes (Windows network profile, WSL2 NAT) and the static IP are in the developer's `AGENT_NOTES.md` and `infra/dev-stand/README.md` → Bootstrap checklist. |
