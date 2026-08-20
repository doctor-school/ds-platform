---
"@ds/schemas": major
"@ds/design-system": major
---

003 EARS-36 — the creation-password policy is now **length only**: at least 8
characters, with no upper-case, lower-case, digit, or symbol requirement.

- `@ds/schemas` exports `PASSWORD_MIN_LENGTH` / `PASSWORD_MAX_LENGTH` as the single
  SSOT constants mirroring the explicitly-provisioned Zitadel instance
  password-complexity policy (`minLength = 8`, every character-class flag `false`).
  **Breaking:** `NEW_PASSWORD_COMPLEXITY` (the four-class regex) is removed, and
  `NewPasswordSchema` no longer enforces a composition rule.
- `@ds/design-system` `NewPasswordFieldSchema` composes the same constants, so the
  portal's client-side pre-validation (EARS-22) cannot drift from the API baseline.
- The login guard is deliberately unchanged (permissive shape check): every
  credential created under the previous four-class policy keeps authenticating —
  nothing is rotated, invalidated, or re-validated.
