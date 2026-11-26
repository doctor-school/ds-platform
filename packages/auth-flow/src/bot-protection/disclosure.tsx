import { Link as DsLink } from "@ds/design-system/link";
import { cn } from "@ds/design-system/lib/utils";

import { resolveAuthFlowCopy } from "../copy";
import type { AuthFlowHostConfig } from "../host-config";

/** The vendor's own processing notice (003 EARS-17) — the same page for every host. */
export const SMARTCAPTCHA_NOTICE_URL =
  "https://yandex.com/legal/smartcaptcha_notice/";

/**
 * 003 EARS-17 — «Форма защищена Yandex SmartCaptcha. Условия обработки данных.»
 * under every bot-protected form, drawn exactly where the host config carries a
 * site key (no key — the dev stand — no challenge and no notice). One
 * definition for the auth doors and every other protected intake (033 EARS-7).
 * `tone="on-primary"` is the same notice on the invariant brand surface (the
 * Academy home partnership form, 033 EARS-18): full-strength on-brand ink and an
 * underlined link, since the brand colour no longer marks it as a link.
 */
export function BotProtectionDisclosure({
  config,
  tone = "default",
  className,
}: {
  config: Pick<AuthFlowHostConfig, "botProtection" | "copy">;
  tone?: "default" | "on-primary";
  className?: string;
}) {
  if (!config.botProtection?.siteKey) return null;
  const disclosure = resolveAuthFlowCopy(config).botProtectionDisclosure;
  return (
    <p
      className={cn(
        tone === "on-primary"
          ? "text-caption text-primary-surface-foreground"
          : "text-xs leading-normal text-faint",
        className,
      )}
      data-testid="smartcaptcha-disclosure"
    >
      {disclosure.notice}{" "}
      <DsLink
        href={SMARTCAPTCHA_NOTICE_URL}
        variant={tone === "on-primary" ? "inline" : "standalone"}
        tone={tone}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={disclosure.linkLabel}
      >
        {disclosure.link}
      </DsLink>
    </p>
  );
}
