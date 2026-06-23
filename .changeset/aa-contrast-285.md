---
"@ds/design-system": minor
---

fix(285): WCAG-AA contrast on the auth surfaces (ADR-0013 §7). The filled primary `Button` no longer paints `primary` (blue.500 #2D84F2 — white only 3.69:1). A new accessible action-fill triad carries it: `primary-action` (blue.700 #114D9E, white 8.14:1, resting) → `primary-hover` / `primary-pressed` (blue.800 #0D3A77, 11.12:1), so every state clears AA while keeping a visible resting→hover interaction delta (#270 L1/L3). `primary` stays blue.500 as the brand anchor (link text, focus ring, icons, tints). `muted-foreground` darkens neutral.500 → neutral.600 (on `muted` neutral.100: 4.31:1 → 6.77:1), fixing the inactive Tabs-trigger contrast. The L4 axe-core scan on `/login` `/register` `/reset` is now green and promoted WARN → BLOCK.
