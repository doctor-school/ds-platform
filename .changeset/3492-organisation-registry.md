---
"@ds/api": minor
"@ds/schemas": minor
"@ds/api-client": minor
"@ds/db": minor
---

Organisation registry (032, #3492): migration 0054 renames the partner registry to `organisations` / `project_organisations` with every id, slug, state and link kept, adds the organisation-role reference book (Инвестор, Клиническая площадка, Образовательный лицензиат) and gives every absorbed partner the investor role. The admin API moves to `/v1/admin/organisations` and gains a description, two public display rules and a role set; `/v1/admin/organisation-roles` lists, adds and renames roles.
