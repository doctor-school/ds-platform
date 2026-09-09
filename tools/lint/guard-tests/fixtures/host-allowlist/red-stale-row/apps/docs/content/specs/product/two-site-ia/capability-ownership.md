# Capability ownership

## Registry

| Capability              | Status |
| ----------------------- | ------ |
| `apps/portal/**` sample | shared |

## Host-file allowlist

Answer key for every scanned host file.

### `apps/doctor/lib`

| path                      | reason                         | until     |
| ------------------------- | ------------------------------ | --------- |
| `apps/doctor/lib/a.ts`    | host brand/config              | permanent |
| `apps/doctor/lib/gone.ts` | wave 2 twin — deleted by #2028 | wave 2    |
