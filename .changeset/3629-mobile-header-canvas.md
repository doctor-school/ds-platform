---
"@ds/storefront-shell": patch
"@ds/design-system": minor
---

The storefront header below the `layout` breakpoint now follows the `ds-shell` canvas mobile composition (#3629): the bar is one row — wordmark, theme toggle, `≡` — and the auth primary («Войти / Регистрация», «Личный кабинет») is the last item of the `≡` menu, full width, instead of a chip in the bar that pushed a 320 px phone sideways. It stays the ONE auth cluster in the DOM (017 EARS-1): the menu panel is the disclosure's sibling and dissolves into the bar from `layout` up, where the header is unchanged. `@ds/design-system` gains the `header-action` Button variant with its `menu-chip` / `menu-avatar` sizes — the canvas menu primary below `layout`, the `on-primary` header chip from `layout` up.
