/**
 * Shared interaction-state contract fragment (ADR-0013 §7 layer 2, #273).
 *
 * The common state set every interactive primitive carries as a component
 * contract — a visible keyboard focus ring, a colour transition, and the
 * disabled dim — composed into each primitive's class/cva base so the states
 * travel with the component wherever it is used. The global base-reset
 * (`globals.css @layer base`, L1 #272) owns cursor + `prefers-reduced-motion`
 * platform-wide; this is the per-component layer on top of it.
 *
 * Token-only: no arbitrary Tailwind values (the §5 / #269 arbitrary-value guard
 * must stay green). Compose with `cn(...)` and add the element-specific pieces
 * (`disabled:pointer-events-none` for clickables, `disabled:cursor-not-allowed`
 * for text inputs, hover/active feedback per variant) alongside it.
 */
export const interactiveBase =
  "ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50";
