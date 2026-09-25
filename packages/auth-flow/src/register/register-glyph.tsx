import { UserPlus } from "lucide-react";

import type { AuthFlowRegisterIcon } from "../host-config";

/**
 * The registration card's glyph, named by `brand.registerIcon` (#2027 PR 1.6).
 * Both drawings are moved verbatim from their hosts — the Academy's lucide mark,
 * the doctor storefront's square-capped user-plus. Both draw in currentColor,
 * the accent the AuthCard tile paints (canvas 62: #2D84F2 light, the accent-dark
 * value in dark) — a pinned `text-primary` stayed #2D84F2 on the dark card. Purely decorative: the
 * heading carries the meaning, exactly as `LoginGlyph` does for the sign-in door.
 */
export function RegisterGlyph({ icon }: { icon: AuthFlowRegisterIcon }) {
  switch (icon) {
    case "user-plus":
      return <UserPlus aria-hidden />;
    case "user-plus-square":
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          aria-hidden
          focusable="false"
        >
          <path
            d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"
            strokeWidth="2"
            strokeLinecap="square"
          />
          <path
            d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"
            strokeWidth="2"
            strokeLinecap="square"
          />
          <path d="M19 8v6" strokeWidth="2" strokeLinecap="square" />
          <path d="M22 11h-6" strokeWidth="2" strokeLinecap="square" />
        </svg>
      );
  }
}
