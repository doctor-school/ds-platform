// Anti-pattern (3): `bg-primary-surface` paired with the ACTION foreground token.
// `primary-foreground` repoints to dark ink in `.dark` (it pairs with the light-blue
// dark-theme action fill), while `primary-surface` stays blue.700 in both themes —
// dark-on-dark, ~1.2:1 (the #517 review blocker). The guard must fail this (exit 1).
export function Sample() {
  return (
    <aside className="bg-primary-surface p-12 text-primary-foreground">
      Panel copy that vanishes in dark theme.
    </aside>
  );
}
