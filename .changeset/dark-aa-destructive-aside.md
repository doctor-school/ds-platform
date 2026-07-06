---
"@ds/design-system": minor
---

Fix dark-theme AA-contrast defects surfaced by the #515 full-page dark axe scan (#537):

- **`destructive` dark fill** now lifts to `#C81E1E` (red.500, white 5.50:1) instead of `#E15555` (3.73:1, below the 4.5:1 normal-text floor) — the destructive Button and invalid-input fill now clear AA in dark. Owner-approved value against the `design-source/design-system.dc.html` danger family.
- **New `destructive-text` role** carries the field/form error MESSAGE text (`FormMessage` / `FormError`), split from the `destructive` FILL: a fill under white text needs a dark red, but the same red as text on the near-black dark card is only 3.09:1, so error text rides its own token (light `#C81E1E` / dark `#E15555`, 4.75:1) and stays legible in both themes.
- **New `primary-surface-muted` role** (`#cfdbec`, 5.81:1 on the blue.700 brand panel) replaces the element `opacity-*` dim on the `AuthLayout` brand-aside sub-copy (eyebrow / value-prop / footer) with a real AA-safe token.

The runtime `playwright-axe` scan now runs every showcase route in **both** themes (light + dark), so dark-mode AA regressions are machine-caught.
