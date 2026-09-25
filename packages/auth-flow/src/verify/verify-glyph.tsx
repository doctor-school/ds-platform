/**
 * The confirmation card's glyph — the canvas `icons.verify` drawing
 * (`design-source/auth.dc.html` 412): an envelope with a check. One drawing on
 * every host (the canvas switches no verify icon per storefront), in
 * currentColor so the AuthCard tile paints the accent. Decorative only — the
 * heading carries the meaning, as it does for `LoginGlyph` and `RegisterGlyph`.
 */
export function VerifyGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      <path d="M3 6h18v12H3z" />
      <path d="M3 7l9 6 9-6" />
      <path d="M8 20l3 3 6-6" />
    </svg>
  );
}
