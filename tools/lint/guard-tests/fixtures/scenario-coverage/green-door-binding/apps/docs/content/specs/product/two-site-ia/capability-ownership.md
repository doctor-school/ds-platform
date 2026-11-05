# Capability ownership (fixture)

## Route-file registry

### `apps/login/app`

| path                               | package         | until          |
| ---------------------------------- | --------------- | -------------- |
| `apps/login/app/layout.tsx`        | — brand frame   | permanent      |
| `apps/login/app/login/page.tsx`    | `@ds/auth-flow` | mounted        |
| `apps/login/app/register/page.tsx` | `@ds/auth-flow` | mounted        |
| `apps/login/app/verify/page.tsx`   | `@ds/auth-flow` | wave 9 (#9009) |

## Next section

| `apps/login/app/reset/page.tsx` | `@ds/auth-flow` | mounted |
