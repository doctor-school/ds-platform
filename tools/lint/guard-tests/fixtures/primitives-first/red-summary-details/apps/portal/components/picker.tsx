/**
 * RED — #1103 (a): a `<summary>` disclosure trigger (the pre-#1101 month-picker
 * shape) with a hand-assembled state stack. `summary`/`details` were not in the
 * #828 raw-interactive tag list — now they are.
 */
export function Picker() {
  return (
    <details className="relative">
      <summary className="inline-flex items-center bg-header-foreground text-sm font-extrabold hover:opacity-90 focus-visible:shadow-focus">
        Month
      </summary>
      <nav>…</nav>
    </details>
  );
}
