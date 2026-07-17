---
"@ds/portal": patch
---

Month view Stage-B rework #3 (#1080, owner verdict #3 at #1052): the calendar surfaces (month grid, week listing, hero inner bands) span the full canvas 1240px content column at desktop, and the app-shell header renders the canvas light-theme blue `#2D84F2` — one continuous band with the hero poster (both via `@ds/design-system` tokens, no component change); the month-fidelity e2e pins the 1240px grid content width, the header/hero colour seam in both themes, and the live pill's 700 text weight. AA on the light blue.500 band (owner pick, Mode-a): the desktop nav links enlarge to the WCAG large-text tier (`text-xl` 20px, weight 700 — the ≥3:1 large/bold carve-out; underline-active treatment unchanged), and the white header chips (Войти / avatar / mobile ≡) switch their ink from `header` to the new `header-chip-foreground` canvas navy `#114D9E` (8.14:1 on white, both themes).
