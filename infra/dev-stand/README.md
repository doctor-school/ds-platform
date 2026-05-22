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

Full design: [`ds-platform-local-dev-environment-setup-design`][spec] in the `bbm`
repo. The compose stack itself lands with DSP-150 — this directory currently holds
only the bootstrap checklist (DSP-152).

[spec]: https://github.com/sidorovanthon/bbm/blob/main/docs/superpowers/specs/2026-05-18-ds-platform-local-dev-environment-setup-design-en.md

---

## Bootstrap checklist

One-time prerequisites before the dev-stand can be brought up. Steps 1–2 are
recipe-specific (TrueNAS Hybrid); steps 3–5 are host-side and apply to anyone
talking to a remote Docker host over SSH.

Re-run the **verification** command after each step. The stand is bootstrap-ready
when all five verifications pass.

### 1. SSH access to TrueNAS Docker

The dev-stand reaches Docker as `ssh://claude@truenas.local` (setup-design §4, §9).
The `claude` user already exists on TrueNAS with the host key in
`~/.ssh/authorized_keys` — SSH itself works. The one gap: `claude` is **not** in the
`docker` group, so it can only reach the daemon via `sudo docker`. `DOCKER_HOST=ssh://`
needs direct socket access, so `claude` must join the `docker` group.

- On TrueNAS (one-time): `sudo usermod -aG docker claude`, then open a fresh session
  so the new group takes effect.
- On the host, the `truenas` SSH alias maps to `claude` + the right key. For
  `DOCKER_HOST=ssh://claude@truenas.local` to resolve the same way, extend the alias
  in `~/.ssh/config` to also match the mDNS name:

  ```
  Host truenas truenas.local
      HostName 192.168.1.115
      User claude
      IdentityFile ~/.ssh/truenas
  ```

**Verification** (from the host):

```powershell
ssh truenas "id && docker version"
```

`id` must list `docker` in the groups; `docker version` must print both Client **and**
Server sections. A `permission denied ... /var/run/docker.sock` on the Server section
means the `docker` group has not taken effect yet (reconnect the session).

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
ssh truenas "docker version"
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
with the compose stack in DSP-150; the rules are fixed here so DSP-150 implements them:

- **Project name** — the compose stack sets a fixed `name: ds-platform-dev`, so every
  container is `ds-platform-dev-<svc>-1` and never clashes with `home-budgeting-system-*`.
- **Network** — a dedicated bridge `ds-platform-dev_default`; no `network_mode: host`,
  no shared external networks.
- **Volumes** — named volumes are project-prefixed; ZFS bind-mounts live under the
  dev-stand-only datasets `Daily/dev-*` (setup-design §5.3).
- **Host ports** — the setup-design port list collides with ports already bound on
  TrueNAS. DSP-150 must remap these:

  | Service (spec port)                                                                    | Status on TrueNAS              | Action for DSP-150                |
  | -------------------------------------------------------------------------------------- | ------------------------------ | --------------------------------- |
  | Postgres `5432`                                                                        | **in use** (`5433` also taken) | remap host side, e.g. `5442:5432` |
  | `8000`                                                                                 | **in use**                     | remap, e.g. `8100:8000`           |
  | `8001`                                                                                 | **in use**                     | remap, e.g. `8101:8001`           |
  | `6379`, `9000`, `9001`, `9080`, `9443`, `3100`, `4000`, `1025`, `8025`, `3592`, `3593` | free                           | keep as-is                        |

  Prefer **not publishing** internal-only ports at all and reaching services over the
  Docker network / SSH tunnel; publish only what the host apps genuinely need.

**Verification** — re-check for collisions before `compose up` (free ports print nothing):

```powershell
ssh truenas "sudo ss -tlnH | awk '{print \$4}' | sed 's/.*://' | sort -nu" |
  Select-String -Pattern '^(5432|8000|8001|6379|9000|9001|9080|9443|3100|4000|1025|8025|3592|3593)$'
```

---

## Checklist status

| #   | Check                                   | Status                            |
| --- | --------------------------------------- | --------------------------------- |
| 1   | SSH access — `claude` in `docker` group | ⬜ pending — `usermod -aG docker` |
| 2   | DHCP reservation `192.168.1.115`        | ⬜ pending — manual router step   |
| 3   | Windows network profile = Private       | ✅ verified 2026-05-22            |
| 4   | OpenSSH client present                  | ✅ verified 2026-05-22            |
| 5   | mDNS resolution + SSH smoke test        | ⬜ blocked on step 1              |
