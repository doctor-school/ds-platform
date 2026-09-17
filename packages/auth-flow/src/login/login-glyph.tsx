import { ShieldCheck } from "lucide-react";

import type { AuthFlowLoginIcon } from "../host-config";

/**
 * The sign-in card's glyph, named by `brand.loginIcon` (#2027 PR 1.5). Both
 * drawings are moved verbatim from their hosts — the Academy's lucide mark with
 * its primary tint, the doctor storefront's square-capped shield in currentColor
 * — so the lift is invisible on each host. Purely decorative: the heading carries
 * the meaning.
 */
export function LoginGlyph({ icon }: { icon: AuthFlowLoginIcon }) {
  switch (icon) {
    case "shield-check":
      return <ShieldCheck className="text-primary" aria-hidden />;
    case "shield-check-square":
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          aria-hidden
          focusable="false"
        >
          <path
            d="M12 2 4 5v6c0 5 3.4 9.1 8 11 4.6-1.9 8-6 8-11V5l-8-3Z"
            strokeWidth="2"
            strokeLinecap="square"
          />
          <path d="m9 12 2 2 4-4" strokeWidth="2" strokeLinecap="square" />
        </svg>
      );
  }
}
