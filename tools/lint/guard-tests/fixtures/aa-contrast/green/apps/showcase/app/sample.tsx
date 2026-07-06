// Clean: AA-safe tokens throughout — the quiet tier at FULL strength, the AA-safe
// emphasis fill `bg-primary-action` under text, a text-LESS `bg-primary` colour
// swatch, and a `bg-primary-surface` panel with its PAIRED
// `text-primary-surface-foreground` (white in both themes). The guard must pass
// this (exit 0).
export function Sample() {
  return (
    <div>
      <p className="text-sm text-muted-foreground">Quiet, AA-safe at full strength.</p>
      <button className="bg-primary-action text-primary-foreground">Save</button>
      <div className="h-10 w-10 bg-primary" aria-hidden />
      <aside className="bg-primary-surface text-primary-surface-foreground">
        Correctly paired panel copy.
      </aside>
    </div>
  );
}
