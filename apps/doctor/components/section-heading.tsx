/**
 * The storefront section heading anatomy drawn by every doctor canvas: the title
 * baseline-aligned in a flex row with a full-width 2px rule running to the edge
 * of the content column (`doctor-home.dc.html` L77-80, `doctor-docs.dc.html`
 * L64-67 and L155-158 — one idiom, `clamp(24px,3.6vw,36px)`/800 beside
 * `border-top:2px solid ink` nudged up by 6px onto the baseline).
 *
 * It lives here rather than inline in one view because two storefront surfaces
 * now draw it (the specialty catalogue and `/documents`), and a second copy of
 * the class list is exactly the drift that lets one section keep the rule while
 * the next one loses it.
 *
 * The rule is decorative: a presentational `<span>`, not an `<hr>` a screen
 * reader would announce.
 */
export function SectionHeading({
  id,
  children,
}: {
  /** Optional, for a `aria-labelledby` section wrapper. */
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex items-baseline gap-4 layout:mb-6">
      <h2
        id={id}
        className="whitespace-nowrap text-2xl font-extrabold leading-none tracking-tight text-foreground layout:text-4xl"
      >
        {children}
      </h2>
      <span aria-hidden="true" className="-translate-y-1.5 flex-1 border-t-2 border-foreground" />
    </div>
  );
}
