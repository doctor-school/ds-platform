import NextLink from "next/link";
import { Button } from "@ds/design-system/button";
import { Link as DsLink } from "@ds/design-system/link";

/**
 * GREEN: the sanctioned compositions. The DS primitive owns the interaction
 * states; a per-surface hover:/active: override ON THE PRIMITIVE is allowed
 * (it is the contract owner), the inner raw `next/link` stays classless, and
 * raw tags with no state utilities carry no bespoke contract.
 */
export default function Page() {
  return (
    <main>
      <DsLink
        asChild
        className="font-normal text-foreground hover:bg-muted hover:no-underline active:text-foreground"
      >
        <NextLink href="/account">Profile</NextLink>
      </DsLink>
      <Button asChild>
        <NextLink href="/start">Start</NextLink>
      </Button>
      <a href="https://example.com">Docs</a>
      <button type="button" className="w-full text-left">
        Plain row
      </button>
    </main>
  );
}
