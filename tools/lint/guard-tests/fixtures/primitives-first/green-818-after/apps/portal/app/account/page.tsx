import NextLink from "next/link";
import { Link as DsLink } from "@ds/design-system/link";

/**
 * GREEN — AC-4 (#828) + #1103: the fully-conformant `/account` RowLink. The DS
 * `Link` primitive owns the interaction contract via `asChild` over a CLASSLESS
 * `next/link`, carrying ONLY its states (`hover:bg-muted`, `hover:no-underline`,
 * `active:text-foreground`) plus positional layout — NO geometry. The row chrome
 * (`border-t`, `py-4`) lives on the `<li>` wrapper, not the primitive, so the
 * #1103 SHELL rule sees no visual-identity rebuild on the DsLink. (The pre-#1103
 * shape put `border-t`/`py-4` ON the DsLink — that residual look-rebuild is the
 * shell loophole this guard now closes; see the `red-shell-*` fixtures.)
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
    <li className="border-t border-border py-4 layout:py-5">
      <DsLink
        asChild
        className="flex flex-col gap-1.5 font-normal text-foreground hover:bg-muted hover:no-underline active:text-foreground layout:flex-row layout:items-center layout:gap-5"
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
    </li>
  );
}

export default function AccountPage() {
  return (
    <ul>
      <RowLink href="/account/password" label="a" title="b" helper="c" />
    </ul>
  );
}
