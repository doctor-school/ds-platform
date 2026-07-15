import * as React from "react";
import Link from "next/link";

/**
 * In-app navigation is EXEMPT: an `<a>` bound to a non-`*Url` route prop
 * (`href`, `ctaHref`), a relative/anchor literal, a Next `<Link>`, a
 * scheme-less `mailto:` (documented exempt — not a browsing-context nav), and a
 * `<a …>` that appears only inside a STRING LITERAL (not real JSX) must all PASS.
 */
export function Nav({
  href,
  ctaHref,
  label,
}: {
  href: string;
  ctaHref: string;
  label: string;
}) {
  // A string literal that merely CONTAINS anchor-like text — the string-aware
  // scanner must not treat this as a real JSX anchor: "<a href={externalUrl}>".
  const helpText = 'render an "<a href={foo.bar.pdfUrl}>" without target here';
  return (
    <nav data-help={helpText}>
      <a href={href} className="text-card-foreground">
        {label}
      </a>
      <a href={ctaHref}>Enter room</a>
      <a href="/webinars">All webinars</a>
      <a href="#top">Back to top</a>
      <a href="mailto:hello@doctor.school">Email us</a>
      <Link href="/account">Account</Link>
    </nav>
  );
}
