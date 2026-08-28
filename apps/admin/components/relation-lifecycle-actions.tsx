"use client";

import { useState } from "react";
import { useCustomMutation } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert, Button } from "@ds/design-system";
import type { RelationshipStatus } from "@ds/schemas";
import { taxonomyErrorKey } from "@/lib/taxonomy-errors";
import type { RelationshipTransition } from "@/providers/data-provider";

/**
 * The retire / restore bar of a #1483 direction relation (ADR-0016 §5).
 *
 * ONE transition is ever offered, because a two-state lifecycle admits exactly
 * one move from either state: an active row can only be retired, a retired one
 * only restored. Deriving the button from the row's CURRENT status — rather than
 * rendering both and letting the server refuse one — is the same rule the 007
 * lifecycle bar follows: the admin offers only transitions that are valid now.
 *
 * The row's `version` rides as `meta.version`, which the provider turns into the
 * `If-Match` precondition this route requires; a stale one comes back as 412 and
 * is rendered as «обновите страницу», never swallowed. The two relations share
 * this component and differ only by their RU namespace, so neither can drift into
 * saying something the other does not.
 */
export function RelationLifecycleActions({
  namespace,
  status,
  version,
  urlFor,
  onTransition,
}: {
  namespace: "directionSpecialties" | "directionAdjacency";
  status: RelationshipStatus;
  version: number;
  urlFor: (transition: RelationshipTransition) => string;
  onTransition: () => void;
}) {
  const t = useTranslations();
  const { mutate, mutation } = useCustomMutation();
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const transition: RelationshipTransition =
    status === "active" ? "retire" : "restore";

  return (
    <div className="flex flex-col gap-3">
      {errorKey ? (
        <Alert variant="danger" data-testid="transition-error">
          {t(errorKey)}
        </Alert>
      ) : null}
      <div>
        <Button
          type="button"
          variant="outline"
          disabled={mutation.isPending}
          data-testid={`relation-${transition}`}
          onClick={() => {
            setErrorKey(null);
            mutate(
              {
                url: urlFor(transition),
                method: "post",
                // An empty object, not `undefined`: the provider only sends a
                // `content-type` when a body exists, and a transition POST with a
                // JSON content-type and NO body is refused by Fastify before the
                // handler runs.
                values: {},
                meta: { version },
              },
              {
                onSuccess: () => onTransition(),
                onError: (error) =>
                  setErrorKey(
                    taxonomyErrorKey(
                      error,
                      `${namespace}.errors.transitionFailed`,
                    ),
                  ),
              },
            );
          }}
        >
          {t(`${namespace}.actions.${transition}`)}
        </Button>
      </div>
    </div>
  );
}
