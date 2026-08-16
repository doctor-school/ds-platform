# Academy home demo

`@ds/academy-demo` is a deterministic, development-only review app for the
logged-out Academy home composition. Run it with `pnpm --filter
@ds/academy-demo dev`; the root route is served on port 3003.

The exact vendored canvas sources, in precedence order, are:

1. `design-source/home.dc.html` — variant V, logged-out state
2. `design-source/webinar-card.dc.html`
3. `design-source/expert-card.dc.html`

This app is not a production surface. It has no API, authentication, BFF,
environment configuration, data fetching, analytics, or deployment contract.
All content is deterministic fixture data. The lead area is intentionally
disabled: it has no form, submit handler, validation-success state, or network
request, and it cannot send personal data.

Intentional design-system deltas are retained for Stage B: owned `Container`
rhythm and responsive remaps define the geometry; owned `WebinarCard` keeps its
standard `МСК` label and exposes no public CTA; project tiles are static page
composition; navigation uses local hash targets; the mobile menu and login are
honestly disabled; and the past webinar uses a quiet opacity treatment. Expert
cards now use five owner-supplied portraits optimized locally as WEBP; the
genuinely missing sixth asset remains an honest initials + `фото ожидается`
fallback rather than an invented or web-sourced identity photo.
