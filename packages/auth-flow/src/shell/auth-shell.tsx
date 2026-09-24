import type { ReactNode } from "react";
import Image from "next/image";

import { AuthShell as AuthShellBlock } from "@ds/design-system/blocks";
import { Link as DsLink } from "@ds/design-system/link";

import { resolveAuthFlowCopy } from "../copy";
import type { AuthFlowHostConfig } from "../host-config";

/** The vendor's own processing notice (003 EARS-17) — the same page for every host. */
const SMARTCAPTCHA_NOTICE_URL = "https://yandex.com/legal/smartcaptcha_notice/";

export type AuthShellProps = {
  config: AuthFlowHostConfig;
  /**
   * 021 EARS-2 (#1538) — the return-context block that FILLS the split's left
   * half when the visitor arrived from a content gate. The block stands it in the
   * panel's middle zone in place of the value prop and widens the split;
   * unsupplied ⇒ the value prop renders (EARS-3).
   */
  returnContext?: ReactNode;
  children: ReactNode;
};

/**
 * `<AuthShell>` — the ONE chromeless auth frame both storefronts mount (row 47,
 * #2027 PR 1.5; ADR-0013 A1 cross-front reuse). It projects the shared
 * `@ds/design-system/blocks` `<AuthShell>` — split grid, three-zone brand panel,
 * one wordmark per viewport (#237/#275) — and adds the 003 EARS-17 SmartCaptcha
 * processing notice under the card.
 *
 * Every host difference is config DATA: the wordmark (with an optional dark-theme
 * variant), the panel mark, the brand copy and the notice copy. There is no i18n
 * runtime here — a host hands its sentences over as strings — and no hook, so the
 * frame is server-safe; the nested form carries its own client boundary.
 *
 * The notice renders exactly where `config.botProtection.siteKey` is set: the
 * value the challenge itself runs on, read by the host from its literal
 * `process.env.NEXT_PUBLIC_…` expression. A host that challenges discloses.
 *
 * Assets are static SVGs served `unoptimized` (ADR-0013 §8): a tiny vector needs
 * no Next re-encode; the intrinsic size is the host's value and `h-* w-auto`
 * scales the display. THE FORM-COLUMN MARK MAY FOLLOW THE THEME (#1955): where the
 * host states `wordmark.darkSrc`, both lockups render and the class-based `dark:`
 * variant shows exactly one — a swap, not a second mark.
 */
export function AuthShell({ config, returnContext, children }: AuthShellProps) {
  const { wordmark, panel } = config.brand;
  const { brand: brandCopy, botProtectionDisclosure: disclosure } =
    resolveAuthFlowCopy(config);

  return (
    <AuthShellBlock
      returnContext={returnContext}
      logo={
        <>
          <Image
            src={wordmark.src}
            alt={wordmark.alt}
            width={wordmark.width}
            height={wordmark.height}
            priority
            unoptimized
            className={
              wordmark.darkSrc ? "h-10 w-auto dark:hidden" : "h-10 w-auto"
            }
            data-testid="auth-wordmark"
          />
          {wordmark.darkSrc ? (
            /* The same mark in white for the dark page — identical alt, so a reader
               hears the name once on either theme. */
            <Image
              src={wordmark.darkSrc}
              alt={wordmark.alt}
              width={wordmark.width}
              height={wordmark.height}
              unoptimized
              className="hidden h-10 w-auto dark:block"
              data-testid="auth-wordmark-dark"
            />
          ) : null}
        </>
      }
      panelMark={
        /* Decorative — the headline carries the accessible name. The white mark
           sits directly on the blue panel (no chip, no inversion). */
        <Image
          src={panel.src}
          alt=""
          width={panel.width}
          height={panel.height}
          unoptimized
          className="h-12 w-auto"
          data-testid="auth-panel-wordmark"
        />
      }
      copy={brandCopy}
    >
      {children}
      {config.botProtection.siteKey ? (
        <p
          className="mt-3.5 text-xs leading-normal text-faint"
          data-testid="smartcaptcha-disclosure"
        >
          {disclosure.notice}{" "}
          <DsLink
            href={SMARTCAPTCHA_NOTICE_URL}
            variant="standalone"
            target="_blank"
            rel="noopener noreferrer"
            aria-label={disclosure.linkLabel}
          >
            {disclosure.link}
          </DsLink>
        </p>
      ) : null}
    </AuthShellBlock>
  );
}
