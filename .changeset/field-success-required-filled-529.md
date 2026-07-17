---
"@ds/design-system": minor
---

Add the three deferred source §07 «Формы и валидация» field states (#529, deferred from #512): (1) a **success** tone on `FormMessage` — a `success` prop renders the `✓ <msg>` confirmation (canvas `✓ Адрес подтверждён`) in a new AA-safe `success-text` token (the green mirror of `destructive-text`: light `green.700` #047857 at 5.49:1, dark `green.400`; the `success` fill stays 3.68:1 as text), with a green `success` border + `success-tint` fill on the input keyed on `data-success`; (2) a **required** prop on `Label` → the destructive `*` marker (`Email *`), `aria-hidden` so the programmatic required semantics stay on the input; (3) a **filled-border** on plain `Input` — a JS has-value signal (mirroring the OTP slot, not `:placeholder-shown`) switches the resting border `hairline` → ink `border` once the field holds a value, safe for controlled and uncontrolled usage. New primitive `green.700` + semantic `success-text` token.
