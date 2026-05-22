# Local dev-stand

Local development environment for DS Platform — Postgres, Redis, MinIO, Centrifugo,
Cerbos, Mailpit and friends, run as a Docker Compose stack.

The platform contract (compose files, `.env.example`, DX wrappers) is portable and
lives in git. Each developer picks a **recipe** for _where_ Docker actually runs.
The reference recipe — "TrueNAS Hybrid" — runs app processes on the host and the
stateful containers on a LAN TrueNAS box reached over SSH.

On this recipe the TrueNAS box is **shared** with unrelated projects (home-budgeting,
media-index, RTMP, TrueNAS Apps). The dev-stand must stay isolated from them — see
[Container isolation](#container-isolation).

Docker on the box runs via `sudo docker` over the `truenas` SSH alias — the
established convention for this server (see `home-budgeting-system/ARCHITECTURE.md`
§11). DX wrappers (`tools/dev/*.sh`, DSP-150) call `sudo docker compose` over
`ssh.exe`; the `DOCKER_HOST=ssh://` transport is **not** used (it needs direct socket
access — deferred, setup-design §11 OQ-1).

Full design: [`local-dev-environment-setup-design`][spec]. This directory
currently holds the Layer-A **skeleton** — the bootstrap
checklist (DSP-152) plus the portable-contract files stubbed by DSP-153. The
compose contract itself (`compose.core.yml` service definitions) is filled in by
DSP-154; the ZFS recipe by DSP-155; the `pnpm dev:*` DX scripts by DSP-156.

[spec]: ../../apps/docs/content/specs/tech/2026-05-18-local-dev-environment-setup-design-en.md

---

## Setup

The dev-stand is two layers (setup-design §2.1): the **portable contract** in git
(`compose.core.yml`, `.env.example`, this README) and a **personal recipe** kept
outside git (`.env.local`, `compose.override.yml`). Setup order:

1. **Prerequisites** — for the TrueNAS Hybrid recipe, complete the
   [Bootstrap checklist](#bootstrap-checklist) below first. Host-only recipes can
   skip it.
2. **Personal env** — copy the env template and fill in real values for your
   machine (`HOST`, `DOCKER_HOST`, passwords, data paths):

   ```powershell
   cp .env.example ~/.ds-platform/.env.local
   ```

3. **Personal override (optional)** — only if your recipe needs a non-default
   storage topology (bind mounts, cloud disks). Named volumes work without it:

   ```powershell
   cp compose.override.example.yml ~/.ds-platform/compose.override.yml
   ```

4. **Start the stack** — `pnpm dev:up` (DX scripts land with DSP-156; the core
   services they bring up land with DSP-154).

`.env.local` and `compose.override.yml` are gitignored (see `.gitignore` in this
directory) — they hold per-machine secrets and must never be committed.

> **Save bootstrap secrets** (`POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`,
> `IDP_SECRET_KEY`, …) in a password manager. They are not covered by ZFS
> snapshots or host backups — on a wipe they are lost and must be rotated
> (setup-design §10).

---

## Bootstrap checklist

One-time prerequisites before the dev-stand can be brought up. Step 1–2 are
recipe-specific (TrueNAS Hybrid); steps 3–5 are host-side and apply to anyone
talking to a remote Docker host over SSH.

Re-run the **verification** command after each step. The stand is bootstrap-ready
when all five verifications pass.

### 1. SSH access to TrueNAS Docker

The dev-stand reaches Docker over the `truenas` SSH alias as user `claude`, which
is already provisioned on the box (key in `~/.ssh/authorized_keys`, passwordless
sudo). Docker commands run with `sudo docker` — `claude` is intentionally **not** in
the `docker` group, matching the existing server convention. No new user, no group
change is needed.

The host `~/.ssh/config` alias:

```
Host truenas
    HostName 192.168.1.115
    User claude
    IdentityFile ~/.ssh/truenas
```

**Verification** (from the host):

```powershell
ssh truenas "sudo docker version"
```

Must print both Client **and** Server sections.

### 2. DHCP reservation for TrueNAS

Pin TrueNAS to `192.168.1.115` so `truenas.local` and the static-IP fallback stay
stable across leases (setup-design §5.4).

- On the router: add a DHCP reservation binding the TrueNAS MAC to `192.168.1.115`.

**Verification:**

```powershell
ping truenas.local        # must resolve to 192.168.1.115
arp -a 192.168.1.115      # confirm the MAC matches TrueNAS
```

### 3. Windows network profile = Private

The Windows mDNS resolver answers `*.local` only on a **Private** profile. On a
fresh install or after a profile reset, `truenas.local` silently fails until
switched (setup-design §5.2, caveat 1).

- If the profile is `Public`, switch it:

  ```powershell
  Set-NetConnectionProfile -InterfaceIndex <N> -NetworkCategory Private
  ```

**Verification:**

```powershell
Get-NetConnectionProfile | Select-Object Name, InterfaceIndex, NetworkCategory
```

`NetworkCategory` must be `Private`.

### 4. OpenSSH client present

DX wrappers shell out to the native Windows `ssh.exe`. Windows 11 ships the
OpenSSH client by default.

**Verification:**

```powershell
where.exe ssh
ssh -V
```

If missing: Settings → System → Optional features → add **OpenSSH Client**.

### 5. mDNS resolution + SSH smoke test

End-to-end check that `truenas.local` resolves and Docker is reachable.

**Verification:**

```powershell
ping truenas.local
ssh truenas "sudo docker version"
```

Attach the `docker version` output to the DSP-152 Plane thread once it passes.

> **WSL2 caveat:** mDNS inside WSL2 default NAT mode does not work
> (microsoft/WSL#12354). Run DX scripts from native Windows `ssh.exe`, or fall back
> to the static IP `192.168.1.115` in WSL's `/etc/hosts`.

---

## Container isolation

The TrueNAS box co-hosts unrelated Docker workloads (`home-budgeting-system-*`,
`media-index-system`, `rtmp-server`) and TrueNAS Apps (`ix-jellyfin`, `ix-transmission`,
`ix-pihole`). The DSP dev-stand must not collide with any of them. Enforcement lands
with the compose stack in DSP-154; the rules are fixed here so DSP-154 implements them:

- **Project name** — the compose stack sets a fixed `name: ds-platform-dev`, so every
  container is `ds-platform-dev-<svc>-1` and never clashes with `home-budgeting-system-*`.
- **Network** — a dedicated bridge `ds-platform-dev_default`; no `network_mode: host`,
  no shared external networks.
- **Volumes** — named volumes are project-prefixed; ZFS bind-mounts live under the
  dev-stand-only datasets `Daily/dev-*` (setup-design §5.3).
- **Host ports** — the setup-design port list collides with ports already bound on
  TrueNAS. DSP-154 must remap these:

  | Service (spec port)                                                                    | Status on TrueNAS                                             | Action for DSP-154                |
  | -------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------- |
  | Postgres `5432`                                                                        | **in use** — `home-budgeting-system-db-1` (`5433` also taken) | remap host side, e.g. `5442:5432` |
  | `8000`                                                                                 | **in use**                                                    | remap, e.g. `8100:8000`           |
  | `8001`                                                                                 | **in use**                                                    | remap, e.g. `8101:8001`           |
  | `6379`, `9000`, `9001`, `9080`, `9443`, `3100`, `4000`, `1025`, `8025`, `3592`, `3593` | free                                                          | keep as-is                        |

  Prefer **not publishing** internal-only ports at all and reaching services over the
  Docker network / SSH tunnel; publish only what the host apps genuinely need.

**Verification** — re-check for collisions before `compose up` (free ports print nothing):

```powershell
ssh truenas "sudo ss -tlnH | awk '{print \$4}' | sed 's/.*://' | sort -nu" |
  Select-String -Pattern '^(5432|8000|8001|6379|9000|9001|9080|9443|3100|4000|1025|8025|3592|3593)$'
```

---

## Checklist status

| #   | Check                                 | Status                  |
| --- | ------------------------------------- | ----------------------- |
| 1   | SSH access — `claude` + `sudo docker` | ✅ verified 2026-05-22  |
| 2   | DHCP reservation `192.168.1.115`      | ✅ confirmed 2026-05-22 |
| 3   | Windows network profile = Private     | ✅ verified 2026-05-22  |
| 4   | OpenSSH client present                | ✅ verified 2026-05-22  |
| 5   | mDNS resolution + SSH smoke test      | ✅ verified 2026-05-22  |
