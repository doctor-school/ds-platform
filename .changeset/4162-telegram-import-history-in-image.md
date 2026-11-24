---
"@ds/api": patch
---

#4162: the 048 one-off Telegram history import runs from the production api image — its entry moved from `scripts/` into `src/materials/telegram/telegram-import-history.main.ts`, so it compiles into `dist/` and runs as `docker compose run --rm --no-deps -v <export folder>:/export:ro api node dist/materials/telegram/telegram-import-history.main.js --source t.me/<address> --export /export/result.json`, with no tsx or repo source tree; `pnpm --filter @ds/api telegram:import-history` keeps working on a workstation. Malformed arguments now print the usage.
