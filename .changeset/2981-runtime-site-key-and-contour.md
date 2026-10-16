---
"@ds/auth-flow": major
"@ds/portal": patch
"@ds/doctor": patch
---

Environment-agnostic storefront images (#2981): the SmartCaptcha site key is read from the runtime env `SMARTCAPTCHA_SITE_KEY` per request by the `@ds/auth-flow` server mounts instead of being baked as the `NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY` build arg, and `/__contour/app-paths-manifest.json` is served only when the runtime env sets `CONTOUR_MANIFEST=1`. `@ds/auth-flow` major: `AuthFlowHostConfig.botProtection` is now optional and resolved by the mounts — a host-stated value is replaced by the runtime one.
