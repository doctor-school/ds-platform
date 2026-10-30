---
"@ds/api": minor
"@ds/schemas": minor
"@ds/api-client": minor
---

Organisation public display rules and count (032, #3494): every public read that projects an organisation — a project's partners, a partner's projects and the primary partner embedded in project summaries — now honours the two display rules. An organisation whose name may not be shown is left out entirely (its own partner page answers 404 like an unknown one, and a project it leads shows no primary partner); one whose logo may not be shown keeps its place with no logo. The new `GET /v1/public/organisations/count` returns `{ count }` of the published organisations of any role, hidden ones included, computed on every request.
