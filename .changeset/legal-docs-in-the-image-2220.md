---
"@ds/doctor": patch
"@ds/portal": patch
---

`/documents/<slug>` (privacy policy, photo/video consent) answers 200 again in the built image: the root `.dockerignore` no longer strips `packages/legal-content/documents/*.md` from the on-box build context, so `outputFileTracingIncludes` ships the texts into the standalone bundle. The `standalone-boot` CI check now probes `/documents` and `/documents/privacy-policy` per app and requires HTTP 200 (#2012).
