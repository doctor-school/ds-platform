/**
 * The recovery card's glyph — the canvas `icons.reset` drawing
 * (`design-source/auth.dc.html` 418): a key. One drawing on every host (the
 * canvas switches no reset icon per storefront), in currentColor so the AuthCard
 * tile paints the accent. Decorative only — the heading carries the meaning, as
 * it does for `LoginGlyph`, `RegisterGlyph` and `VerifyGlyph`.
 */
export function ResetGlyph() {
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
      <path d="M8 13a4 4 0 1 0-4-4" />
      <path d="M8 9l12 12" />
      <path d="M17 18l2-2" />
      <path d="M19 16l2-2" />
    </svg>
  );
}
