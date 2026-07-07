---
title: Valid frontmatter fixture
surface: user-facing
issues: [1, 2, 3]
prior_decisions:
  - "ADR-0001 — Identity / Auth / RBAC (`access: authenticated`, `required_roles: admin`)"
  - ADR-0002 — Backend Core Stack (nestjs-zod)
---

# Body

A well-formed spec whose `prior_decisions` list quotes the entry that carries a
`: ` colon-space, so the frontmatter YAML parses cleanly.
