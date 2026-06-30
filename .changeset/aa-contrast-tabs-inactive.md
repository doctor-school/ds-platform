---
"@ds/design-system": patch
---

Fix the inactive `Tabs` trigger to use the AA-safe quiet tier `text-muted-foreground` (full strength) instead of an opacity-dimmed `text-foreground/60`. An opacity modifier on a foreground token drops it below the WCAG-AA contrast threshold (#270); the muted-foreground token is the designated quiet-but-readable tier. Hover still resolves to full `text-foreground`. Surfaced by the new static `aa-contrast` guard (#402) and confirmed AA-clean by the showcase axe scan (#351).
