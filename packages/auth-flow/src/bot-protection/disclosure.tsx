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
 */
export function BotProtectionDisclosure({
  config,
  className,
}: {
  config: Pick<AuthFlowHostConfig, "botProtection" | "copy">;
  className?: string;
}) {
  if (!config.botProtection?.siteKey) return null;
  const disclosure = resolveAuthFlowCopy(config).botProtectionDisclosure;
  return (
    <p
      className={cn("text-xs leading-normal text-faint", className)}
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
  );
}
