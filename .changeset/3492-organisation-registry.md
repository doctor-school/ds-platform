---
"@ds/api": minor
"@ds/schemas": minor
"@ds/api-client": minor
"@ds/db": minor
"@ds/admin": minor
---

Organisation registry (032, #3492): migration 0054 renames the partner registry to `organisations` / `project_organisations` with every id, slug, state and link kept, adds the organisation-role reference book (Инвестор, Клиническая площадка, Образовательный лицензиат) and gives every absorbed partner the investor role. The admin API moves to `/v1/admin/organisations` and gains a description, two public display rules and a role set; `/v1/admin/organisation-roles` lists, adds and renames roles. In the admin, «Партнёры» become «Организации» — a list with roles, status and update date, and a full-page form with a description, the roles as checkboxes and the two display rules — and the new «Роли организаций» section lists the roles with their holder counts, adds and renames them.
