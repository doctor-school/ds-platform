---
"@ds/design-system": minor
"@ds/portal": patch
"@ds/doctor": patch
---

Shared `AuthShell` block: the canvas auth frame (brand panel over `AuthLayout`) is one canonical implementation both storefronts project

`apps/portal` and `apps/doctor` each carried their own copy of the same three-zone brand panel, and the two had drifted apart on headline scale and on the panel mark's alignment. The frame now lives once in `@ds/design-system/blocks` as `<AuthShell>`, built from the canvas (`design-source/auth.dc.html`): the mark pinned top-left, the value prop centred in the remaining space, the panel's footer line, and the 021 return-context swap that also widens the split. Both apps keep a thin projection holding only what the package refuses to hold — brand assets, localized copy, and app policy (the portal's authenticated-redirect guard and its SmartCaptcha disclosure). Academy's auth panel converges onto the canvas typography and mark alignment; behaviour is unchanged on both sides.
