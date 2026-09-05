import { cn } from "../lib/utils";

/**
 * The white-on-header neo-brutalist chip surface — the canvas header chip
 * (`design-source/webinar-room.dc.html` §header, `background:#fff`, navy
 * `#114D9E` ink in BOTH themes via `header-chip-foreground`).
 *
 * Its offset shadow casts in `shadow-header-chip` — the theme-INVARIANT dark ink
 * offset (`header-chip-shadow` = neutral.900 both themes), NOT the generic
 * `shadow-btn`, whose `border` cast flips to WHITE in dark and rendered the chip
 * a white square with a white shadow on the navy band (#1145).
 *
 * This is the SINGLE source both storefronts compose from (AGENTS.md §6
 * cross-front reuse): the static chip is the `header` variant of the DS
 * {@link import("./avatar").Avatar}, and the interactive chip is
 * {@link HEADER_CHIP_BASE} below — neither restates the surface, so the two
 * cannot drift.
 */
export const HEADER_CHIP_SURFACE =
  "bg-header-foreground text-header-chip-foreground shadow-header-chip";

/**
 * The INTERACTIVE header chip base — {@link HEADER_CHIP_SURFACE} plus the
 * neo-brutalist press chain, for chips that are links or buttons (the academy's
 * profile chip, the shell's «Войти» chip and mobile ≡). Interaction mirrors the
 * DS Button press: rest → hover sinks 1px (`shadow-header-chip-hover`) → press
 * sinks 2px and drops the shadow, ink pinned full-strength on press (the
 * primitive's press tint goes near-white on the white chip in dark).
 *
 * Size/padding/weight compose on top per chip. A NON-interactive chip must use
 * the `header` Avatar variant instead — hover affordance without a target is the
 * dead affordance 020 EARS-4 forbids.
 */
export const HEADER_CHIP_BASE = cn(
  "inline-flex flex-none items-center justify-center",
  HEADER_CHIP_SURFACE,
  "hover:no-underline hover:translate-x-px hover:translate-y-px hover:shadow-header-chip-hover active:translate-x-0.5 active:translate-y-0.5 active:shadow-none active:text-header-chip-foreground",
);
