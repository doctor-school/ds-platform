---
"@ds/doctor": patch
---

017 EARS-2 / EARS-14 — the storefront home hero heading fits the phone viewport.

Below the `layout` breakpoint the headline «Doctor.School — бесплатное
образование для врачей» renders at the `text-3xl` token instead of `text-4xl`:
the brand token has no break opportunity inside it and at 3.5rem it overran the
358px content box of a 390px phone by 19px, which propagated to `html` and made
the whole home page scroll sideways. The desktop `layout:text-6xl` render is
unchanged.
