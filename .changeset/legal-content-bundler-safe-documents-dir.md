---
"@ds/legal-content": patch
---

Resolve the default documents directory with `join(dirname(fileURLToPath(import.meta.url)), "..", "documents")` instead of `new URL("../documents/", import.meta.url)`. Bundlers treat the literal `new URL(..., import.meta.url)` form as a static asset reference and fail the consuming build with `Module not found: Can't resolve '../documents/'`, which made the package unusable from the Next.js server components it is written for. Runtime behaviour is unchanged.
