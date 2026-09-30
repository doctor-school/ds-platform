---
"@ds/auth-flow": minor
"@ds/portal": patch
"@ds/doctor": patch
---

One sign-out destination on both storefronts (#2488).

- `@ds/auth-flow/host-config` exports `SIGN_OUT_DESTINATION` (`"/"`, 003
  EARS-10): where a visitor lands after signing out from `/account`. A package
  constant, not host data — the two storefronts cannot diverge on it.
- The Academy account page now sends a signed-out visitor to the storefront home
  (`/`) instead of `/login`; doctor.school already did. Both account screens
  navigate to the package constant.
