/**
 * The white-on-header neo-brutalist chip surface — the canvas header chip
 * (`design-source/ds-shell.dc.html` line 37, `background:#fff`, navy `#114D9E`
 * ink in BOTH themes via `header-chip-foreground`).
 *
 * Its offset shadow casts in `shadow-header-chip` — the theme-INVARIANT dark ink
 * offset (`header-chip-shadow` = neutral.900 both themes), NOT the generic
 * `shadow-btn`, whose `border` cast flips to WHITE in dark and rendered the chip
 * a white square with a white shadow on the navy band (#1145).
 *
 * This is the SINGLE surface both storefronts and the webinar room compose from
 * (AGENTS.md §6 cross-front reuse), and it is consumed in exactly two places:
 *   • the INTERACTIVE chip — the `on-primary` variant of the DS
 *     {@link import("./button").Button}, whose `chip` / `icon` / `avatar` sizes
 *     are the only header-chip geometries there are (#2180). A second
 *     class-string constant beside it is what let the two storefronts' chips
 *     drift to 194×44 and 191×48.
 *   • the STATIC chip — the `header` variant of the DS
 *     {@link import("./avatar").Avatar}, for a chip that is NOT a target
 *     (hover affordance without one is the dead affordance 020 EARS-4 forbids).
 */
export const HEADER_CHIP_SURFACE =
  "bg-header-foreground text-header-chip-foreground shadow-header-chip";
