---
"@ds/design-system": minor
---

#2027 — every auth form in the package submits by POST. `<LoginCard>`,
`<PasswordRecoveryCard>`, `<RegisterCard>`, `<EmailConfirmCard>` and
`<OtpFocusScreen>` render their `<form>` with `method="post"`, so a visitor who
presses the button before the bundle hydrates submits natively into the request
BODY instead of GET-ing their password, identifier or one-time code into the
URL, the browser history and every access log on the way. `action` stays off:
the HTML default is the current document URL, which is the path the native
submit should use, and a path prop would put a host route inside the design
system. No visual delta — the rendered surface is unchanged.

The auth family is also retuned to the owner's canvas, in RENDERING and not only
in words. The sign-up and sign-in cards step their inner padding to 36px, raise
the badge tile to 52px with the accent glyph, put the title on its own 26px kegel
and drop the footer to the 13px caption; every secondary line of the door — the
password hint, the access-conditions eyebrow, the withdrawal note, the consent
help and the terms sentence — moves to the faint tone and the half-step kegels
the canvas actually draws. Two of those are package defaults rather than auth
overrides, because a field is one thing: `Checkbox` states its label at 13.5px on
the 1.4 line, and `FormMessage` speaks its helper in the 12px/600 faint voice for
every field in the system.

`FormError` gains a public `variant` prop. `banner` draws the canvas plate an
operation-level refusal deserves — a 2px danger frame on the danger tint, the
sentence itself at 13px/700 in ink so it is read rather than shouted — while the
default `inline` keeps the bare line a field-level failure uses. The sign-in door
now reports a refused attempt as that plate, and both of its choice groups are
named with the same eyebrow the sign-up door's conditions use.

New type tokens back the above: `font.size.pill` (11.5px, `text-pill`) and
`font.size.title-xl` (26px, `text-title-xl`); the named `font.line-height` tokens
are additionally mapped onto Tailwind's `--leading-*` namespace, so
`leading-title|label|notice|prose` exist as utilities — previously those tokens
drove no utility at all.

Dark-mode field controls now sit on the surface colour (`bg-card`) instead of
the page background, matching every design-source canvas: `Input`, `Textarea`,
`NativeSelect` and the `Combobox` control and search field. Light is unchanged
(both tokens are white there).
