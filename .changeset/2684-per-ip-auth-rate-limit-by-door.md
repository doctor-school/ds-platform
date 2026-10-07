---
"@ds/api": patch
---

EARS-13 (#2684): the per-IP auth rate-limit window splits by door. Verification doors (password login, code login, verify, password-reset-complete) give back their own per-IP unit on success, so 20 / 15 min per IP counts failed verifications; sending doors (code request, register, resend, password-reset request, sign-in hand-off) consume their own per-IP window of 60 / 15 min. Per-user and per-ASN are unchanged; `RATE_LIMIT_PER_IP_15MIN` moves both per-IP windows.
