---
"@ds/design-system": minor
---

Re-skin the core interactive primitives into the neo-brutalist visual language (#512), driven by the #511 tokens.

- **Button** — every variant is now a hard 2px-bordered, square slab with a token offset shadow (`4px 4px 0`) that presses into the page: hover nudges +2px and shrinks the shadow to 2px, pressed nudges +4px and drops it, disabled loses the shadow and dims. Bold labels. `link` stays a bare text link.
- **Input / fields** — 2px square border, a blue focus border + ring, a `data-success` green hook, and an error state carried by a destructive border + faint danger tint.
- **Label** — the compact 12/700 caption.
- **Form errors** — the inline field error and the form-level error are now 12/700 danger led by a `⚠` marker (decorative, `aria-hidden`); the helper stays quiet.
- **Card** — square 2px border + offset shadow.
- **Tabs** — a hard-bordered segment control; the active segment fills with the primary action colour.
- **Input OTP** — square 2px cells with tabular, uppercase glyphs; a filled cell takes the ink border, an empty one stays muted.

All token-driven; renders across the full state set in both light and dark themes.
