// Green fixture (scope c): app text links route through the @ds/design-system
// `Link` primitive via `asChild`, so the inner `next/link` `<Link>` carries NO
// className (the DS primitive owns hover + focus + brand colour). This mirrors
// the real portal footer/nav pattern (login/register/reset pages). A bare
// unstyled <a href> is also fine — it declares no bespoke look and inherits the
// layer-1 reset.
import Link from "next/link";
import { Link as DsLink } from "@ds/design-system/link";

export function Page() {
  return (
    <footer>
      <DsLink asChild>
        <Link href="/register">Create account</Link>
      </DsLink>
      <DsLink asChild>
        <Link href="/reset">Forgot password</Link>
      </DsLink>
      <a href="/help">Help</a>
    </footer>
  );
}
