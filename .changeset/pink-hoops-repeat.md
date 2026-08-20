---
"@ds/portal": patch
"@ds/admin": patch
---

Pin `next` to 16.3.0 in the portal and admin apps. Next 16.3.1 bumps its `@swc/helpers`
dependency to 0.5.23, whose export map adds a `module-sync` condition that Node ≥22.10
honours in `require()` — the runtime then resolves `@swc/helpers/_/*` to `esm/*.js`, while
Next's output-file tracing still copies only the `cjs/*.cjs` variants into
`.next/standalone`. The standalone production images therefore crash-loop at boot with
`MODULE_NOT_FOUND` before serving a single request.
