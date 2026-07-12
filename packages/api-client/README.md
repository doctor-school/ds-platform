# `@ds/api-client`

The DS Platform **generated SDK** — the typed client the frontends use to call
`@ds/api`, generated from the OpenAPI surface via **openapi-typescript**
(ADR-0002). **Do not edit by hand** — this package is regenerated from the API's
contract; changes belong in `@ds/schemas` / the API controllers, then regenerate.

## Status — reserved scaffold

This is a **reserved, generated workspace slot**: the package currently holds only
its `package.json` (name `@ds/api-client`, `private`). The generated client lands
when the SDK-generation step is wired into the build. Until then it declares no
scripts and exports nothing.

## Public surface

_None yet_ — the generated typed client + types arrive with SDK generation. When
present, it is **generated output**, not authored code.

## Build / test

No package-local scripts yet; the client will be produced by the generation step
(from the API OpenAPI document), not hand-authored. Today it is a no-op in
`turbo run` fan-outs.

## Owning ADR

- **ADR-0002** — backend core stack (openapi-typescript SDK).
