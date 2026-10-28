---
title: "Prod incident response runbook (read-only diagnosis, live-SHA redeploy)"
description: "Diagnosing a production incident without box access: the monitoring box as the read path, alert state, triage order, the Prometheus/Loki/netconsole/provider query catalogue, recovery verbs with their authorization, provider escalation, and the 2026-10-28 incident as the worked example."
lang: en
---

# Prod incident response runbook

How to diagnose and recover a production incident on ds-api-prod / ds-data-prod
when nobody holds an operator shell on those boxes. Diagnosis is read-only and
runs from the monitoring box; recovery runs through the release workflow
`deploy-prod.yml`. Release mechanics themselves live in the
[release pipeline spec](../specs/tech/2026-10-16-release-pipeline-off-workstation-en.md)
and the [`run-prod-deploy` skill](../skills/run-prod-deploy/SKILL.md).

## 1. Access model

- **No standing operator ssh to the prod boxes** (release pipeline spec §4).
  The CI key's forced-command entrypoint (`infra/deploy/bin/ds-deploy-entrypoint`)
  serves only `status` / `release` / `rollback` / `rollback-status` /
  `upload-report` — no logs, no shell.
- **Break-glass keys** (user `breakglass`) are held offline by the owner. A
  break-glass session is the owner's action, never the lead agent's.
- **The read path is the monitoring box `mon-prod-tw`** (operator ssh alias
  `mon-prod-tw`; its config SSOT is `infra/monitoring/` in the `sidorovanthon/bbm`
  repo). Alloy on both prod boxes ships metrics, container logs and the host
  journal to it, so every question below is answered there.

## 2. Detection

Alerts are **Grafana-managed** rules; Prometheus `rule_files` is empty, so read
alert state from Grafana, not Prometheus:

```bash
curl -s -u "<admin>:<password>" http://localhost:3000/api/alertmanager/grafana/api/v2/alerts
```

(admin credentials are in the monitoring box's deploy `.env`; never print them).

| Rule                                 | Severity | Probe / target                                                 | `for` |
| ------------------------------------ | -------- | -------------------------------------------------------------- | ----- |
| `ApplicationHealthProbeFailed`       | critical | `probe_scope=app_health`: `api…/v1/ready`, `id…/debug/healthz` | 2m    |
| `ProcessLivenessProbeFailed`         | critical | `api…/v1/health`                                               | 2m    |
| `ExternalHttpProbeFailed`            | warning  | `user_path`: `academy…/`, `id…/`                               | 2m    |
| `DSDataHealthProbeFailed` / `…Stale` | —        | data-prod health                                               | 5m    |
| cert-expiry rules                    | —        | TLS certificates                                               | —     |

They route by `tenant=ds` to receiver `ds` (email, Mattermost, Telegram).
Blackbox targets (tenant `ds`): `https://api.doctor.school/v1/health`,
`https://api.doctor.school/v1/ready`, `https://academy.doctor.school/`,
`https://id.doctor.school/`, `https://id.doctor.school/debug/healthz`.

## 3. Triage order

Answer these in order; each answer narrows the next query.

1. **Which probe is red, and since when?** `probe_success{tenant="ds"}` now, then
   a `query_range` (step 300) to find the outage start.
2. **Which box, which container?** `up{tenant="ds"}` for the node targets; a red
   `/v1/health` with a green node points at the api container, a red node at the
   box itself. Caddy's log tells a refusal (`connection refused` — nothing
   listening) from a timeout (upstream alive but stuck).
3. **Boot failure or runtime failure?** Find the last
   `successfully started` line of the api container. No such line after the
   latest boot ⇒ the boot failed; read the non-noise lines from the boot time.
4. **Did the host reboot, and who did it?** `node_boot_time_seconds` jumps on a
   reboot; the host journal says whether it was the provider
   (`qemu-guest-agent … guest-shutdown called, mode: powerdown`), unattended
   upgrades, or a kernel panic (netconsole).

## 4. Query catalogue

### Prometheus

Run inside container `monitoring-deploy-prometheus-1`:
`docker exec monitoring-deploy-prometheus-1 wget -qO- 'http://localhost:9090/api/v1/query?query=<expr>'`
(`/api/v1/query_range?query=…&start=…&end=…&step=300` for history).

| Expression                                                                      | Answers                                |
| ------------------------------------------------------------------------------- | -------------------------------------- |
| `probe_success{tenant="ds"}`                                                    | which public probe is red now          |
| `probe_success{tenant="ds"}` via `query_range`, step 300                        | when the outage started                |
| `up{tenant="ds"}` (job `integrations/unix`, `instance="api-prod"\|"data-prod"`) | is the box's agent reporting at all    |
| `node_boot_time_seconds{instance="api-prod"}` (and `data-prod`)                 | did the box reboot, and when           |
| `node_load5`, `node_memory_MemAvailable_bytes`                                  | load / memory pressure                 |
| `node_filesystem_avail_bytes{mountpoint="/"}`                                   | disk full                              |
| `rate(node_cpu_seconds_total{mode="steal"}[5m])`                                | a noisy neighbour on the provider host |

### Loki

On `mon-prod-tw` (host network, no tenant header):

```bash
curl -sG localhost:3100/loki/api/v1/query_range \
  --data-urlencode 'query=<logql>' \
  --data-urlencode start=<ns> --data-urlencode end=<ns> \
  --data-urlencode limit=200 --data-urlencode direction=forward
```

Timestamps are in nanoseconds. Labels: `host` (`api-prod` / `data-prod`),
`container` (`ds-api-prod-api-1`, `ds-api-prod-caddy-1`, `ds-api-prod-zitadel-1`,
`ds-data-prod-postgres-1`, `ds-data-prod-redis-1`, `ds-data-prod-pgbackrest-1`),
`unit` (systemd units; host journal lines carry `container=""`).

| LogQL                                                                                                                  | Answers                                                              |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `{container="ds-api-prod-api-1"} \|~ "successfully started"`                                                           | the last good api boot                                               |
| `{container="ds-api-prod-api-1"} !~ "InstanceLoader\|RoutesResolver\|RouterExplorer"` from the boot time               | the boot error, without Nest's route-registration noise              |
| `{container="ds-api-prod-caddy-1"} \|~ "dial\|502"`                                                                    | upstream refused vs timed out                                        |
| `{container="ds-data-prod-postgres-1"}`                                                                                | database start, recovery, connection errors                          |
| `{host=~"api-prod\|data-prod", container=""} \|~ "(?i)guest-shutdown\|power key\|unattended\|Powering off\|Rebooting"` | who shut the VM down (provider powerdown, upgrade reboot, power key) |

### netconsole

Container `monitoring-deploy-netconsole-rx-1` on `mon-prod-tw` receives the prod
kernels' console: `docker logs --since <ts> --until <ts> monitoring-deploy-netconsole-rx-1`
shows kernel panics and OOM kills that never reach the journal.

### Provider log

The Timeweb API keeps a per-server action log:

```bash
curl -s -H "Authorization: Bearer $TWC_TOKEN" \
  "https://api.timeweb.cloud/api/v1/servers/<id>/logs?limit=15&order=desc"
```

`TWC_TOKEN` comes from `infra/deploy/.env` (never print it); `<id>` is the server
id from terraform state. A provider-side action shows `user_id: null`
(2026-09-20). Not every provider action is logged: the 2026-10-28 powerdown was
absent from this log — the guest journal (`qemu-guest-agent`) is then the only
evidence.

## 5. Recovery verbs and their authorization

In order of preference:

1. **Redeploy of the live SHA** — recreates every api-compose container at the
   SHA production already runs, with the box's current env: no build, no
   migration, no release cut. The live SHA is the latest `production`
   Deployment record:

   ```bash
   gh api "repos/{owner}/{repo}/deployments?environment=production&per_page=1" --jq '.[0].sha'
   gh workflow run deploy-prod.yml --ref main -f mode=redeploy -f sha=<live sha> -f owner_quote="<quote>"
   ```

   **Authorization:** the owner's standing authorization (chat 2026-10-28,
   Issue #3428) covers a redeploy of the live SHA when a prod health probe is
   red — no fresh owner word is needed. `owner_quote` is still required; it
   carries that standing authorization and the incident reference, and the
   owner is told afterwards with the cause. A redeploy for any other reason (an
   env change on the box) still needs the owner's word.

2. **Rollback** — `mode=rollback` with a required `reason`, under the existing
   rules (a release that visibly broke production; target among the latest 3
   releases). See the `run-prod-deploy` skill.
3. **A new release** — only on a fresh owner word (the fix ships through the
   normal release path).
4. **Break-glass** — the owner only.

**Verify afterwards:** `/v1/health` (its `version` equals the live SHA),
`/v1/ready`, and every user-facing endpoint that was failing (on 2026-10-28:
`/v1/storefront/doctor/events` and `/v1/storefront/doctor/events/live`); then
watch `probe_success{tenant="ds"}` return to 1 and the alert resolve.

## 6. Provider escalation

When the host journal shows a provider powerdown, the owner opens a support
ticket from the owner's provider account. It names the server ids (from
terraform state) and the UTC times, states «powerdown via qemu-guest-agent, not
in the server log», and asks for the cause and for maintenance notices in
future. The lead agent drafts the ticket text; it does not contact the provider.

## 7. What the read path cannot show

- **SQL against prod data.** The old ssh + `docker exec psql` playbook is gone.
  A data question needs an owner break-glass session or an API/admin surface.
- **Container state directly.** There is no `docker ps`; state is inferred. A red
  `/v1/health` + Caddy `connection refused` + recent api log lines = a live
  process with no listener (the container is up, the server never bound).
- **The release driver's journal detail** — the workflow prints status lines
  only; `status prod <sha>` is the read verb.

## 8. Worked example — 2026-10-28

Record: Issue [#3412](https://github.com/doctor-school/ds-platform/issues/3412)
(body + the reboot-cause comment), fix PR
[#3417](https://github.com/doctor-school/ds-platform/pull/3417), recovery run
[40649147779](https://github.com/doctor-school/ds-platform/actions/runs/40649147779).

| UTC           | Event                                                                                           | How it was read                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 04:03 / 04:05 | The provider powered down both VMs via qemu-guest-agent                                         | Loki host-journal query (`guest-shutdown called, mode: powerdown`); absent from the provider log |
| 04:06         | `ApplicationHealthProbeFailed` fired                                                            | Grafana alert state                                                                              |
| 04:24 / 04:25 | Both boxes back up                                                                              | `node_boot_time_seconds`                                                                         |
| —             | The api booted before data-prod was ready; the failed boot left a live process with no listener | api log from boot time (no `successfully started`) + Caddy `connection refused`                  |
| ~07:10        | Noticed                                                                                         | —                                                                                                |
| ~07:15        | Diagnosed, ~5 min, from monitoring alone                                                        | the queries above                                                                                |
| 07:17–07:20   | Redeploy of the live SHA (~3 min)                                                               | run 40649147779; `/v1/health`, `/v1/ready`, the storefront events endpoints green                |

The boot-order defect itself is fixed under #3412 (PR #3417); a bounded connect at boot is
tracked separately as #3421. The lesson for this runbook: the outage lasted
three hours because nobody read the alert, not because diagnosis was hard —
diagnosis took five minutes and recovery three.
