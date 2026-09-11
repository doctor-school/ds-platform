import { Fragment, type ReactNode } from "react";
import Image from "next/image";
import NextLink from "next/link";
import { Link as DsLink } from "@ds/design-system/link";

import type { ShellLink, StorefrontShellConfig } from "./config";
import { VisibleOffPaths } from "./route-visibility";
import styles from "./footer.module.css";

/**
 * 008 EARS-14 · 017 EARS-12 — the storefront footer, defined ONCE for BOTH
 * storefronts (canvas `ds-shell.dc.html`, the `ds-shell · футер` artboard;
 * ADR-0013 canvas-wins).
 *
 * Four columns on the canvas grid: the brand mark with its foot-note, the
 * «Разделы» repeat of the header nav, the documents column, and the SINGLE
 * crossing to the sibling storefront — followed by the giant decorative
 * wordmark bleeding to the page edges.
 *
 * EARS-12 is the load-bearing constraint: each storefront carries exactly ONE
 * link out to the other, and it lives in the cross column. The config models
 * that as a single {@link ShellLink}-shaped value rather than a list precisely
 * so a second crossing cannot be configured into existence — the hosts' e2e
 * specs count occurrences, and a second one is a defect.
 *
 * Like the header this is a SERVER component with no branch on `config.host`
 * (008 EARS-13): the two storefronts differ only in the values they pass, down
 * to the wordmark's container-query font size.
 */
export function StorefrontFooter({
  config,
}: {
  config: StorefrontShellConfig;
}) {
  const chrome = <FooterChrome config={config} />;
  return config.hiddenOnPaths ? (
    <VisibleOffPaths patterns={config.hiddenOnPaths}>{chrome}</VisibleOffPaths>
  ) : (
    chrome
  );
}

/** The footer itself — unaware of whether a route boundary wraps it. */
function FooterChrome({ config }: { config: StorefrontShellConfig }) {
  const { footer, nav } = config;
  return (
    <footer
      data-testid="storefront-footer"
      data-host={config.host}
      className="border-t-2 border-border px-4 pb-9 pt-8 layout:px-12 layout:pb-14 layout:pt-12"
    >
      <div className="mx-auto grid w-full max-w-container-content gap-8 layout:grid-cols-4 layout:gap-10">
        <div>
          {/*
            The brand mark is the vector wordmark, not set text. The footer sits
            on the page surface rather than the navy band, so the canvas swaps
            the asset with the theme: the colour mark on light, the white one on
            dark. Only the visible one carries the accessible name.
          */}
          <Image
            src="/brand/logo.svg"
            alt={config.logo.alt}
            width={500}
            height={164}
            unoptimized
            className={`${styles.logoColor} h-5.5 w-auto`}
          />
          <Image
            src="/brand/logo-white.svg"
            alt=""
            aria-hidden="true"
            width={500}
            height={164}
            unoptimized
            className={`${styles.logoWhite} h-5.5 w-auto`}
          />
          <p
            data-testid="footer-note"
            className="mt-3.5 text-caption font-semibold leading-relaxed text-muted-foreground"
          >
            {footer.note.map((line, index) => (
              <Fragment key={line}>
                {index > 0 ? <br /> : null}
                {line}
              </Fragment>
            ))}
          </p>
        </div>

        {/* «Разделы» repeats the header nav from the SAME config value — the
            two lists cannot drift apart, which is what 008 EARS-14 asks for. */}
        <FooterColumn testId="footer-sections" title={footer.navTitle}>
          <FooterLinks items={nav} />
        </FooterColumn>

        <FooterColumn testId="footer-documents" title={footer.documentsTitle}>
          <FooterLinks items={footer.documents} />
        </FooterColumn>

        <FooterColumn testId="footer-cross" title={footer.cross.title}>
          <DsLink
            variant="inline"
            href={footer.cross.href}
            className="text-sm font-extrabold"
          >
            {footer.cross.label}
          </DsLink>
          <p className="mt-2.5 text-caption font-semibold leading-relaxed text-muted-foreground">
            {footer.cross.note}
          </p>
        </FooterColumn>
      </div>

      {/* The giant wordmark: decorative, hidden from assistive technology, and
          bled to the page edges by negating the footer's own padding. Its size
          is a container-query length carried in the config, so the two hosts
          fit their different wordmark lengths with no script (008 EARS-14). */}
      <div
        aria-hidden="true"
        className={`${styles.giantBox} -mx-4 -mb-9 mt-8 layout:-mx-12 layout:-mb-14 layout:mt-12`}
      >
        <div
          data-testid="footer-giant"
          style={{ fontSize: footer.giant.fontSize }}
          className={`${styles.giant} text-footer-wordmark`}
        >
          {footer.giant.text}
        </div>
      </div>
    </footer>
  );
}

/** One footer column: the uppercase micro-heading plus its content. */
function FooterColumn({
  testId,
  title,
  children,
}: {
  testId: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div data-testid={testId}>
      <h2 className="mb-3.5 text-caption font-extrabold uppercase tracking-widest text-muted-foreground">
        {title}
      </h2>
      {children}
    </div>
  );
}

/** A configured link stack, rendered in order. */
function FooterLinks({ items }: { items: readonly ShellLink[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((item) => (
        <li key={item.href}>
          <DsLink asChild className="text-sm">
            <NextLink href={item.href}>{item.label}</NextLink>
          </DsLink>
        </li>
      ))}
    </ul>
  );
}
