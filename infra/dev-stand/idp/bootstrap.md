# Zitadel — OIDC application bootstrap (reproducible, per recipe)

The `idp` service (Zitadel v4, single binary, DB-backed) comes up self-contained
from `compose.core.yml` and serves OIDC discovery at the root once healthy. This
file turns the _application-level_ setup — the OIDC client the api BFF logs in
through, plus the org-owner credential the provisioner needs — into a scripted,
re-runnable procedure. No console click-paths.

All commands assume the **TrueNAS Hybrid** recipe (`DEV_SSH_HOST=truenas`,
`sudo docker`, remote dir `~/ds-platform-dev-stand`). On a host-only recipe drop
the `ssh truenas` prefix and the `sudo`. Endpoints come from your `.env.local` —
substitute your own `HOST`/ports; the values shown are the reference recipe's.

> **HOST choice.** The issuer must be the address the api on your dev machine
> resolves _and_ the address Zitadel advertises in discovery — they must be
> byte-identical or every OIDC client rejects the issuer. The reference recipe
> uses `truenas.local` (mDNS resolves from Windows to `192.168.1.115`); fall back
> to the static IP only if mDNS fails. Use the SAME value for
> `IDP_EXTERNAL_DOMAIN`, `IDP_ISSUER` (bare origin, **no path**), and the
> provisioner's redirect URIs.

---

## 0. Snapshot first (destructive steps follow)

A re-init drops the `zitadel` database. **Snapshot before touching it**
(AGENTS.md §9.3):

```bash
pnpm dev:snapshot pre-zitadel-reinit
# TrueNAS recipe, by hand if the launcher isn't usable from your env:
ssh truenas 'sudo zfs snapshot "Daily SSD/dev-postgres@pre-zitadel-reinit-$(date -u +%Y%m%dT%H%M%SZ)"'
```

Only the `zitadel` DB and the `idp` container are ever in scope. **Never** touch
`ds_dev` or any other service.

---

## 1. When do you need a re-init?

You need a re-init **only** to (re)create the bootstrap machine user, or to change
`IDP_EXTERNAL_DOMAIN`. If `curl http://<HOST>:9080/.well-known/openid-configuration`
already advertises the right `"issuer"` and a `ds-bootstrap` org-owner user
exists, skip to step 3 (provisioning).

Zitadel stores `ExternalDomain` in the DB at first init; the container env var
only seeds it on a _fresh_ init. Changing the env var on an already-initialised
instance does nothing — you must re-init.

---

## 2. Re-init with a declarative bootstrap machine user

`compose.core.yml` carries an opt-in FIRSTINSTANCE block, gated on `IDP_BOOTSTRAP`.
When set, the init step creates an IAM-owner machine user `ds-bootstrap`, a console
admin `zitadel-admin` with a known password, and disables the v2 login feature so
the single-binary stand serves its built-in login (the v4 v2-login UI is a
separate container this stand does not run).

In your `.env.local` (synced to the remote `.env` on `dev:up`):

```ini
IDP_EXTERNAL_DOMAIN=truenas.local       # = your HOST
IDP_ISSUER=http://truenas.local:9080    # bare origin, no path
IDP_PORT=9080
IDP_BOOTSTRAP=1                          # ONLY during the re-init
IDP_BOOTSTRAP_ADMIN_PASSWORD=<pick one>  # dev-only; needs upper+lower+digit+symbol
```

Drop the `zitadel` DB and recreate the `idp` container so `start-from-init`
re-inits onto a fresh DB:

```bash
ssh truenas 'cd ~/ds-platform-dev-stand && \
  sudo docker compose -f compose.core.yml stop idp && \
  sudo docker compose -f compose.core.yml rm -f idp && \
  sudo docker exec ds-platform-dev-postgres-1 psql -U ds -d ds_dev -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='"'"'zitadel'"'"' AND pid <> pg_backend_pid();" && \
  sudo docker exec ds-platform-dev-postgres-1 psql -U ds -d ds_dev -c "DROP DATABASE IF EXISTS zitadel;" && \
  sudo docker compose -f compose.core.yml up -d idp'
```

Wait for health, then verify the issuer:

```bash
curl -s http://truenas.local:9080/.well-known/openid-configuration | jq -r .issuer
# -> http://truenas.local:9080
```

### Obtaining the bootstrap PAT

> **v4.15 caveat.** `ZITADEL_FIRSTINSTANCE_PATPATH` (PAT-to-file) is wired in the
> compose but does **not** reliably emit a readable file under `start-from-init`
> in the distroless image — the machine user + PAT row land in the DB, but the
> file is not written to the mount. Until that upstream behaviour is sorted, mint
> the PAT once via the (now working) built-in console, using the deterministic
> admin the bootstrap created:

1. Open `http://<HOST>:9080/ui/console`, log in as
   `zitadel-admin@zitadel.<HOST>` with `IDP_BOOTSTRAP_ADMIN_PASSWORD`, skip MFA.
2. The console's session token can mint the PAT without further clicks — in the
   browser devtools console:

   ```js
   const tok = JSON.parse(sessionStorage.getItem("zitadel:access_token"));
   const B = location.origin,
     H = { Authorization: "Bearer " + tok, "Content-Type": "application/json" };
   const u = await (
     await fetch(B + "/management/v1/users/_search", {
       method: "POST",
       headers: H,
       body: JSON.stringify({
         queries: [
           {
             userNameQuery: {
               userName: "ds-bootstrap",
               method: "TEXT_QUERY_METHOD_EQUALS",
             },
           },
         ],
       }),
     })
   ).json();
   const pat = await (
     await fetch(B + "/management/v1/users/" + u.result[0].id + "/pats", {
       method: "POST",
       headers: H,
       body: JSON.stringify({ expirationDate: "2099-12-31T23:59:59Z" }),
     })
   ).json();
   console.log(pat.token); // <-- the PAT, shown ONCE
   ```

3. Save it to a **gitignored** file — never commit it:

   ```bash
   printf '%s' '<PAT>' > ~/.ds-platform/idp-bootstrap-pat.txt
   ```

Then flip `IDP_BOOTSTRAP=` back off (so normal boots don't re-trigger init).

---

## 3. Provision the OIDC application (idempotent)

`idp/provision.sh` creates (or converges) the `ds-platform-dev` project, the
web/OIDC application (`authorization_code` + `refresh_token`, BASIC auth, dev-mode
http redirect URIs), the project-role assertion so
`urn:zitadel:iam:org:project:roles` is emitted in the token, and seeds the
`doctor_guest` role. Re-running it converges — it never duplicates.

```bash
# Runs on a box with bash + curl + jq (the TrueNAS box has all three):
ssh truenas 'cd ~/ds-platform-dev-stand/idp && \
  IDP_BASE_URL=http://truenas.local:9080 ./provision.sh --pat-file /tmp/idp-pat.txt'
```

It prints `PROJECT_ID`, `IDP_CLIENT_ID`, and — **only on first creation** —
`IDP_CLIENT_SECRET`. Capture both. (Re-runs do not re-emit the secret; rotate it
with the `_generate_client_secret` call the script prints if you lose it.)

Override defaults via env / flags: `IDP_REDIRECT_URIS`, `IDP_POST_LOGOUT_URIS`,
`IDP_SEED_ROLE`, `--project-name`, `--app-name`. Defaults target the api BFF
callback (`:3000/auth/callback`) and the portal (`:3100/auth/callback`).

---

## 4. Wire `.env.local`

```ini
IDP_ISSUER=http://truenas.local:9080          # bare origin
IDP_EXTERNAL_DOMAIN=truenas.local
IDP_PORT=9080
IDP_CLIENT_ID=<from provision.sh>             # the numeric Zitadel client id
IDP_CLIENT_SECRET=<from provision.sh>
IDP_SERVICE_TOKEN=<the ds-bootstrap PAT>      # the api binds the real adapter on
                                              # IDP_ISSUER + IDP_SERVICE_TOKEN
```

> The api's `IdpModule` selects the real `ZitadelIdpClient` when **both**
> `IDP_ISSUER` and `IDP_SERVICE_TOKEN` are set; otherwise it falls back to the
> in-memory `FakeIdpClient`. The OIDC `client_secret` is for the
> authorize→token-exchange leg (003 F2 follow-up), not for adapter selection.

---

## 5. Known live wire-shape deltas (v4.15)

A smoke test of the merged real adapter against the live instance surfaced
deltas — tracked as follow-up, **not** silently patched here:

- `POST /v2/users/human` **requires** a `profile` object (`givenName` /
  `familyName`); the merged `ZitadelIdpClient.createUser` omits it → 400.
- The default password policy requires an upper-case character; the fixtures'
  lowercase-only password is rejected.
- Duplicate-email create returns **409** (the adapter's enumeration hinge is
  correct), and the happy path returns `{ userId, details }` (parsed correctly).

The session→token-exchange / refresh / OTP-login legs remain fail-closed seams
(GitHub #122 scope was never implemented); there is no live integration test for
them yet.
