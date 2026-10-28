---
"@ds/api": patch
---

#3412: a failed api boot (a module's `onModuleInit`, `createApiApplication` or `listen` rejecting — e.g. data-prod Postgres unreachable after a provider reboot) now logs the error, reports it to GlitchTip (`Sentry.captureException`), flushes for at most 2 s and exits with code 1, so Docker's `restart: unless-stopped` retries the boot. Before, with `SENTRY_DSN` set the Sentry SDK's `warn`-mode unhandled-rejection handler kept the process alive with no HTTP listener.
