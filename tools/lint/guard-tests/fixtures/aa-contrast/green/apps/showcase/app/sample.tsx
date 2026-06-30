// Clean: AA-safe tokens throughout — the quiet tier at FULL strength, the AA-safe
// emphasis fill `bg-primary-action` under text, and a text-LESS `bg-primary` colour
// swatch. The guard must pass this (exit 0).
export function Sample() {
  return (
    <div>
      <p className="text-sm text-muted-foreground">Quiet, AA-safe at full strength.</p>
      <button className="bg-primary-action text-primary-foreground">Save</button>
      <div className="h-10 w-10 bg-primary" aria-hidden />
    </div>
  );
}
