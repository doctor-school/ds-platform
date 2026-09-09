# Capability ownership

## Host-file allowlist

Answer key for every scanned host file. Route files answer to «Route-file registry» below.

## Route-file registry

Answer key for every `apps/{portal,doctor}/app/**/{page,layout}.tsx`.

### `apps/doctor/app`

| path                                    | package             | until     |
| --------------------------------------- | ------------------- | --------- |
| `apps/doctor/app/**/page.tsx`           | — host-only surface | permanent |
| `apps/doctor/app/(auth)/login/page.tsx` | — host-only surface | permanent |
