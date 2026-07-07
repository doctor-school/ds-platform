---
title: Malformed frontmatter fixture
surface: user-facing
issues: [1, 2, 3]
prior_decisions:
  - ADR-0001 — Identity / Auth / RBAC (`access: authenticated`, `required_roles: admin`, `auth_check: fast-path`)
  - ADR-0002 — Backend Core Stack (nestjs-zod)
---

# Body

The `prior_decisions` entry above is an unquoted block scalar containing `: `
(colon-space), so js-yaml parses it as a nested mapping and throws when fumadocs
compiles the page — the #596 failure class.
