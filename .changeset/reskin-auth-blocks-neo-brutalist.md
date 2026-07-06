---
"@ds/design-system": minor
---

Re-skin the auth blocks to the neo-brutalist language (#517). `AuthCard` now promotes
its `icon` into a square tint badge tile above an up-scaled, heavy title (canvas
`auth-card` unit); `AuthLayout` collapses its split-shell at the semantic `layout`
breakpoint (≥901px, §09 — the token match for the canvas ≤900px fold) instead of the
generic `lg`. `OtpFocusScreen` inherits the neo-brutalist slots/buttons from its
already-re-skinned primitives (#512). Purely visual — no public prop changed and no
behaviour touched (form logic, resend cooldown, masked destination all unchanged).
