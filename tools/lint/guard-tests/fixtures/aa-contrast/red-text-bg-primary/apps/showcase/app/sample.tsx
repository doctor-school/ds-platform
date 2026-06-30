// Defect (2): normal-weight text on the raw brand blue `bg-primary` fails AA — the
// AA-safe emphasis fill is `bg-primary-action` (blue.700). The guard must flag this.
export function Sample() {
  return <div className="bg-primary text-sm text-primary-foreground">Welcome back</div>;
}
