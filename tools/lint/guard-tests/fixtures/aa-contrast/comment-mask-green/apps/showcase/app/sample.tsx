// Both anti-patterns appear ONLY inside comments (a migration note documenting the very
// token to avoid, like tabs.tsx's "Inactive resting is the muted `text-foreground/60`").
// Comments are stripped before scanning, so the guard must NOT raise a false positive
// from a commented occurrence (exit 0).
/* historical: was `text-muted-foreground/70` and `bg-primary text-white` before the fix */
export function Sample() {
  // do not use text-primary-foreground/80 here — kept as a // line-comment reminder
  return <p className="text-sm text-muted-foreground">Clean, real code.</p>;
}
