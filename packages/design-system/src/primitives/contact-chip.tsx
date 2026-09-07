import * as React from "react";

import { cn } from "../lib/utils";

/**
 * `ContactChip` (028, #1966) — one contact channel as a chip: a channel mark plus
 * its label, linking out. The «Документы и контакты» surface lists a support
 * mailbox next to Telegram / ВКонтакте / YouTube, and the only rendering of that
 * shape in the repo was hand-assembled inline (`apps/portal/app/
 * academy-home-view.tsx` L467-479, mailto + t.me anchors), so a second host would
 * have re-hand-assembled it. It lives here as the one implementation both
 * storefronts mount (AGENTS.md §6 cross-front reuse).
 *
 * The chip decides ONE thing on its own, and it is a safety property, not copy:
 * an `https:` destination is off-platform, so it opens in a new tab with the
 * opener severed (`rel="noopener noreferrer"`), while `mailto:` / `tel:` hand off
 * to the operating system and stay in place — a `target="_blank"` there leaves the
 * reader on a blank tab. Everything else (the label, the channel mark, the order)
 * is host-supplied: the design system does not own which channels a storefront has.
 */
export interface ContactChipProps
  extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "children"> {
  /** `mailto:`, `tel:` or an `https:` channel URL. */
  href: string;
  /** Visible label — the address itself or the channel name. */
  label: React.ReactNode;
  /** Channel mark, decorative: the label already names the channel. */
  icon?: React.ReactNode;
}

const ContactChip = React.forwardRef<HTMLAnchorElement, ContactChipProps>(
  ({ href, label, icon, className, ...props }, ref) => {
    const external = /^https?:/i.test(href);
    return (
      <a
        ref={ref}
        href={href}
        data-testid="contact-chip"
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        className={cn(
          "inline-flex items-center gap-2.5 border-2 border-border bg-card px-4 py-3 text-sm font-bold text-card-foreground shadow-sm",
          "hover:text-primary-action focus-visible:text-primary-action focus-visible:shadow-focus",
          className,
        )}
        {...props}
      >
        {icon ? (
          <span aria-hidden="true" className="flex-none">
            {icon}
          </span>
        ) : null}
        <span className="min-w-0">{label}</span>
      </a>
    );
  },
);
ContactChip.displayName = "ContactChip";

export { ContactChip };
