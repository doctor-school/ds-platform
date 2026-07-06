import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Our design tokens add font-size utilities that tailwind-merge does not ship in
 * its default config: `text-2xs`, `text-caption`, `text-body-compact` (the custom
 * `--text-*` theme keys generated from `tokens/*.json`). tailwind-merge classifies
 * an unknown `text-*` class into the **text-COLOUR** group by default — so a
 * naïve `twMerge` treats `text-caption` as a colour and, in a `cn(...)` where a
 * colour and a size co-occur (e.g. a `sm` button = `text-primary-foreground` +
 * `text-caption`), it drops one as a same-group conflict. That silently stripped
 * the foreground COLOUR off filled `sm` buttons → a WCAG contrast regression
 * (#512 review of #528: ink on blue.700 = 2.17:1).
 *
 * Registering the custom sizes in the `font-size` class group makes tailwind-merge
 * treat them as sizes, not colours, so a size + a colour are different groups and
 * BOTH survive. This fixes the whole class of size×colour collisions across every
 * primitive, not just the one button. The default sizes (`xs`/`sm`/`base`/`lg`/…)
 * are already recognised; only the tokens-added names are registered here.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["2xs", "caption", "body-compact"] }],
    },
  },
});

/**
 * Merge conditional class names, then resolve Tailwind utility conflicts
 * (later wins). The single class-composition helper every component uses.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
