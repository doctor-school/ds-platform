# Zitadel — OIDC application bootstrap (manual, per recipe)

> **Status: stub.** The `idp` service (Zitadel) is wired into `compose.core.yml`
> and comes up self-contained — it creates its own database and first instance on
> first boot, and serves OIDC discovery at the root once healthy:
>
> ```
> curl http://${IDP_EXTERNAL_DOMAIN}:${IDP_PORT}/.well-known/openid-configuration
> ```
>
> What remains is the **OIDC application** setup — creating the `ds-platform-dev`
> app, its `client_id` / `client_secret`, redirect URIs for the four Next.js apps
> (plus mobile and api), and scope / group-claim mapping. That work is a
> deliberate follow-up (DSP-157 scope split, 2026-05-28): it is blocked on the
> first real OIDC consumer (likely feature-spec `003-auth`), since every consumer
> app is an empty stub today and configuring Zitadel for non-existent clients
> would be premature. The detailed click-path / API steps land here when that
> consumer arrives. This file is intentionally a header until then.
