---
"@ds/api": minor
---

Registration and password-reset code emails now go through one ordered chain — Postbox, then an optional mail.ru reserve, then Resend — within a 40-second budget, so a provider outage no longer leaves the visitor without a code while a doubtful send is never repeated. The mail.ru reserve is off until explicitly enabled (`MAILER_FALLBACK_SMTP_*`), and each channel's readiness is checked at startup and on every real-email switch without sending a message (#2144).
