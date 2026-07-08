"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@ds/design-system";
import type { EventLifecycleState } from "@ds/schemas";
import { stateLabelKey } from "@/lib/lifecycle";

/**
 * The lifecycle-state badge (007 EARS-9/10). Renders the single
 * `EventLifecycleState` (the source of truth) with its RU catalog label; the
 * `live` state uses the design-system `live` badge (the "в эфире" indicator), all
 * others the neutral `label` tag. Token-only, copy from the catalog.
 */
export function StateBadge({ state }: { state: EventLifecycleState }) {
  const t = useTranslations();
  return (
    <Badge
      variant={state === "live" ? "live" : "label"}
      data-testid={`state-${state}`}
    >
      {t(stateLabelKey(state))}
    </Badge>
  );
}
