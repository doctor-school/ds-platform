---
"@ds/api": minor
---

#4005: 048 EARS-46 — the one-off VK wall history import. `node dist/materials/vk/vk-history-import.main.js --source vk.com/<address>` (in the api image; `pnpm --filter @ds/api vk:import-history` on a workstation) pages `wall.get` by 100 over the whole wall of a bound VK source and writes each post through the connector's EARS-41 mapping and EARS-43 dedup, so a re-run, a Callback-delivered post and a hidden entry are never touched; an unbound source is refused with nothing written; the run stops before the month's VK calls would pass 8 000 and prints read / written / skipped / dropped / calls used.
