# Local dev-stand

Local development environment for DS Platform — Postgres, Redis, MinIO, Centrifugo,
Cerbos, Mailpit and friends, run as a Docker Compose stack.

The platform contract (compose files, `.env.example`, DX wrappers) is portable and
lives in git. Each developer picks a **recipe** for _where_ Docker actually runs.
The reference recipe — "TrueNAS Hybrid" — runs app processes on the host and the
stateful containers on a LAN TrueNAS box reached over SSH.

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

### 1. SSH key authorized on TrueNAS

The dev-stand reaches Docker as `ssh://anton@truenas.local` (setup-design §4, §9).
The `anton` user must exist on TrueNAS, belong to the `docker` group, and carry the
host's public key in `~/.ssh/authorized_keys`.

- On TrueNAS (UI → Credentials → Local Users, or shell): create user `anton`,
  add it to the `docker` group, paste the host public key into its
  `~/.ssh/authorized_keys`.
- Host public key to authorize:

  ```powershell
  Get-Content $HOME\.ssh\truenas_key.pub
  ```

**Verification** (from the host):

```powershell
ssh anton@truenas.local "id && docker version"
```

Expect a clean `docker version` with both Client **and** Server sections. A
`permission denied ... /var/run/docker.sock` on the Server section means `anton`
is not in the `docker` group.

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
ssh anton@truenas.local "docker version"
```

Attach the `docker version` output to the DSP-152 Plane thread once it passes.

> **WSL2 caveat:** mDNS inside WSL2 default NAT mode does not work
> (microsoft/WSL#12354). Run DX scripts from native Windows `ssh.exe`, or fall back
> to the static IP `192.168.1.115` in WSL's `/etc/hosts`.

---

## Checklist status

| #   | Check                                                    | Status                           |
| --- | -------------------------------------------------------- | -------------------------------- |
| 1   | SSH key authorized on TrueNAS (`anton` + `docker` group) | ⬜ pending — manual TrueNAS step |
| 2   | DHCP reservation `192.168.1.115`                         | ⬜ pending — manual router step  |
| 3   | Windows network profile = Private                        | ✅ verified 2026-05-22           |
| 4   | OpenSSH client present                                   | ✅ verified 2026-05-22           |
| 5   | mDNS resolution + SSH smoke test                         | ⬜ blocked on step 1             |
