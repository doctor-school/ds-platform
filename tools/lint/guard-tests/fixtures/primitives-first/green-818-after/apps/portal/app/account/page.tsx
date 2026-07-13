import NextLink from "next/link";
import { Link as DsLink } from "@ds/design-system/link";

/**
 * GREEN — AC-4 (#828): the post-`5948eee` #818 `/account` RowLink shape: the
 * DS `Link` primitive owns the interaction contract via `asChild` over a
 * CLASSLESS `next/link`; the canvas-pinned row state (`hover:bg-muted`,
 * `hover:no-underline`, `active:text-foreground`) rides on the PRIMITIVE.
 */
function RowLink({
  href,
  label,
  title,
  helper,
}: {
  href: string;
  label: string;
  title: string;
  helper: string;
}) {
  return (
    <DsLink
      asChild
      className="flex flex-col gap-1.5 border-t border-border py-4 font-normal text-foreground hover:bg-muted hover:no-underline active:text-foreground layout:flex-row layout:items-center layout:gap-5 layout:py-5"
    >
      <NextLink href={href}>
        <span className="w-36 shrink-0 text-2xs font-extrabold uppercase tracking-micro text-muted-foreground">
          {label}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold">{title}</span>
          <span className="mt-1 block text-caption font-semibold text-muted-foreground">
            {helper}
          </span>
        </span>
        <span aria-hidden className="text-lg font-extrabold text-primary-action">
          →
        </span>
      </NextLink>
    </DsLink>
  );
}

export default function AccountPage() {
  return <RowLink href="/account/password" label="a" title="b" helper="c" />;
}
