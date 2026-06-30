// Defect (1): an opacity modifier on a foreground token drops it below WCAG-AA —
// the AA-safe form is the quiet tier at full strength (#270). The guard must flag this.
export function Sample() {
  return <p className="text-sm text-muted-foreground/70">Dimmed below AA.</p>;
}
