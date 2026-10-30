"use client";

import { useState } from "react";
import { useCustomMutation } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert, Button } from "@ds/design-system";
import type { TaxonomyStatus } from "@ds/schemas";
import { publishBlockers, taxonomyErrorKey } from "@/lib/taxonomy-errors";

/**
 * The publish command of a project / expert / partner record (012 EARS-5, #1287).
 *
 * ONE component for the three verticals rather than three near-copies: the
 * gesture, the protocol and the refusal handling are identical across them, and
 * only the nouns differ — which the derived `namespace` already carries (the
 * same derivation `taxonomyErrorKey` makes). Per AGENTS.md §6 «cross-front
 * capability reuse», the host page supplies its URL builder, its version and its
 * refetch; nothing kind-specific lives in here.
 *
 * It is deliberately the DIRECTION publish half and nothing more
 * (`direction-lifecycle-actions.tsx`):
 *
 * - **Publish only, only from `draft`.** Retire and restore do not exist for
 *   these three kinds yet (#1295/#1296) — the API has no route to call — so
 *   rendering those buttons would be controls that lie. A record that is already
 *   published shows a state sentence and no action.
 * - **A plain command, no impact dialog.** A publish withdraws nothing, so the
 *   §3.1 preview gate has an empty consequence set to display; the gate exists
 *   to make an operator SEE what disappears.
 * - **No delete wording anywhere** (§3.1): the platform retires, never deletes.
 *
 * Refusals are shown as the mapped RU sentence, never a wire code: the
 * completeness refusal and the occupied speaker slot (experts) each have their
 * own actionable line in `taxonomy-errors.ts`. A project's completeness
 * refusal names each missing item — title, description, a result, the stage
 * note, the curator (030 EARS-6) — and, with `onOpenBlocker`, each is a control
 * that opens the tab fixing it.
 */
export function PublishAction({
  namespace,
  id,
  status,
  version,
  publishUrl,
  onPublished,
  onOpenBlocker,
}: {
  /** The message + error namespace: `projects` | `experts` | `organisations`. */
  namespace: "projects" | "experts" | "organisations";
  id: string;
  status: TaxonomyStatus;
  version: number;
  publishUrl: (id: string) => string;
  /** Re-read the detail: the row's version moved, so the next write asserts the new one. */
  onPublished: () => void;
  /**
   * 030 EARS-6 — when given, a refused publish lists each missing item
   * (`<namespace>.publish.blockers.<item>`) as a control that opens the tab
   * fixing it; the host owns the tabs.
   */
  onOpenBlocker?: (item: string) => void;
}) {
  const t = useTranslations();
  const { mutate: publish, mutation: publishing } = useCustomMutation();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<string[]>([]);
  const [published, setPublished] = useState(false);

  return (
    <div
      className="flex flex-col gap-3"
      data-testid={`${namespace}-publish-panel`}
    >
      {errorKey ? (
        <Alert variant="danger" data-testid="publish-error">
          <p>{t(errorKey)}</p>
          {onOpenBlocker && blockers.length > 0 ? (
            <>
              <p className="mt-2 font-bold">
                {t(`${namespace}.publish.blockersTitle`)}
              </p>
              <ul
                className="mt-1 flex list-disc flex-col gap-1 pl-5"
                data-testid="publish-blockers"
              >
                {blockers.map((item) => (
                  <li key={item}>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      data-testid={`publish-blocker-${item}`}
                      onClick={() => onOpenBlocker(item)}
                    >
                      {t(`${namespace}.publish.blockers.${item}`)}
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </Alert>
      ) : published ? (
        <Alert variant="success" data-testid="publish-notice">
          {t(`${namespace}.publish.toast`)}
        </Alert>
      ) : null}

      <p className="text-sm text-muted-foreground">
        {status === "draft"
          ? t(`${namespace}.publish.draftHint`)
          : status === "published"
            ? t(`${namespace}.publish.publishedNote`)
            : t(`${namespace}.publish.retiredNote`)}
      </p>

      {status === "draft" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={publishing.isPending}
            loading={publishing.isPending}
            data-testid={`${namespace}-publish`}
            onClick={() => {
              setErrorKey(null);
              setPublished(false);
              publish(
                {
                  url: publishUrl(id),
                  method: "post",
                  // An empty object, not `undefined`: the provider only sends a
                  // `content-type` when a body exists, and a command POST with a
                  // JSON content-type and NO body is refused by Fastify before
                  // the handler runs.
                  values: {},
                  meta: { version },
                },
                {
                  onSuccess: () => {
                    setErrorKey(null);
                    setPublished(true);
                    onPublished();
                  },
                  onError: (error) => {
                    setPublished(false);
                    setBlockers(publishBlockers(error));
                    setErrorKey(
                      taxonomyErrorKey(
                        error,
                        `${namespace}.errors.publishFailed`,
                      ),
                    );
                  },
                },
              );
            }}
          >
            {t(`${namespace}.publish.action`)}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
