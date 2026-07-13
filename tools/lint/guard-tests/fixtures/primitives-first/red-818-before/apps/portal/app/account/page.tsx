import NextLink from "next/link";

/**
 * RED — AC-4 (#828): the VERBATIM pre-rework #818 `/account` RowLink shape
 * (`git show 5948eee^`): a raw `next/link` imported under the `NextLink`
 * alias, hand-carrying the row hover + focus ring. `interaction-states`
 * scope (c) never fired here (its regex matches tags literally named
 * `<Link>`); this guard resolves the actual `next/link` import identifier.
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
    <NextLink
      href={href}
      className="flex flex-col gap-1.5 border-t border-border py-4 transition-colors hover:bg-muted focus-visible:shadow-focus focus-visible:outline-none layout:flex-row layout:items-center layout:gap-5 layout:py-5"
    >
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
  );
}

export default function AccountPage() {
  return <RowLink href="/account/password" label="a" title="b" helper="c" />;
}
