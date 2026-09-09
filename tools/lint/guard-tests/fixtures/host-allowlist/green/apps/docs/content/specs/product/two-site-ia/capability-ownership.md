# Capability ownership

## Registry

| Capability              | Status |
| ----------------------- | ------ |
| `apps/portal/**` sample | shared |

## Host-file allowlist

Answer key for every scanned host file.

### `apps/doctor/lib`

| path                   | reason            | until     |
| ---------------------- | ----------------- | --------- |
| `apps/doctor/lib/a.ts` | host brand/config | permanent |

### `apps/doctor/components`

| path                           | reason                         | until  |
| ------------------------------ | ------------------------------ | ------ |
| `apps/doctor/components/b.tsx` | wave 1 twin — deleted by #2027 | wave 1 |
