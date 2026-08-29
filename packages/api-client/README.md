# `@ds/api-client`

The DS Platform **generated SDK** — the typed client the frontends use to call
`@ds/api`, generated from the OpenAPI surface via **openapi-typescript**
(ADR-0002). **Do not edit by hand** — this package is regenerated from the API's
contract; changes belong in `@ds/schemas` / the API controllers, then regenerate.

## Public surface

The package exports the generated OpenAPI `paths`, `operations`, and `components`
types. `src/index.ts` is the authored export boundary;
`src/types.generated.ts` and `openapi.snapshot.json` are committed generated
artifacts and must never be edited manually.

## Build / test

```bash
pnpm generate:api-client                    # regenerate snapshot and types
pnpm generate:api-client:check              # compare both, without writes
pnpm --filter @ds/api-client build          # emit dist + declarations
pnpm --filter @ds/api-client typecheck      # validate the generated surface
```

Generation scans the full production-compiled Nest `AppModule`; it does not
start a server, connect to Postgres, or call external services. The generated
header names the owning commands, and CI blocks when either artifact is stale.

## Owning ADR

- **ADR-0002** — backend core stack (openapi-typescript SDK).
