---
"@ds/api": patch
---

EARS-13 auth rate-limit ceilings become env-overridable per var (`RATE_LIMIT_PER_USER_15MIN` / `RATE_LIMIT_PER_IP_15MIN` / `RATE_LIMIT_PER_ASN_1H`) for an ops / load-test window (#1076). Inert additive knob: unset ⇒ the byte-identical EARS-13 defaults (per-user 10/15 min, per-IP 20/15 min, per-ASN 100/h); a malformed / ≤0 / non-integer value is ignored with a loud warn and the default kept — never an unlimited state, never a boot crash.
