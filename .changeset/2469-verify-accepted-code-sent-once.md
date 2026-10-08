---
"@ds/design-system": patch
"@ds/auth-flow": patch
"@ds/portal": patch
"@ds/doctor": patch
---

The registration code step on both storefronts (`/verify`) sends an accepted code once: from «Код принят — входим…» until the page moves on, «Подтвердить и войти» stays busy and inert, and a click, Enter or a re-typed or pasted code no longer posts the spent code again — so the visitor no longer sees a «code did not fit» error under the success row (#2469).
