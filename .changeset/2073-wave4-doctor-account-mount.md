---
"@ds/doctor": patch
"@ds/portal": patch
---

The doctor storefront's `/account` mounts `@ds/account` (#2073, wave-4 PR 4.2), the one account cabinet the Academy already mounts; its fork `components/account-screen.tsx` is deleted. On the doctor storefront the header now picks up a changed display name right after the save. On the Academy the `/account` browser tab reads «Личный кабинет — Doctor.School», the same title as on the doctor storefront.
