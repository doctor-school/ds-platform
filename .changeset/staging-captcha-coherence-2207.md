---
---

#2207 — `pnpm stage:slot up|sync` refuse to converge a slot whose captcha trio is
incoherent (`assertCaptchaCoherent`: OFF needs an empty site key, ON needs both
real vendor TEST halves), the `infra/deploy/stage.env.example` template ships bot
protection OFF with both halves present, and the stg-infra README asserts the
coherence in AC4.

This empty-package release record covers staging operator tooling and its
template; it bumps no workspace package.
