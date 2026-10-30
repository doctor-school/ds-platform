"use client";

import { useState } from "react";
import { useCustomMutation } from "@refinedev/core";
import { useTranslations } from "next-intl";
import {
  Alert,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from "@ds/design-system";
import type { MaterialAdminDetail } from "@ds/schemas";
import { materialRefusedFields, taxonomyErrorKey } from "@/lib/taxonomy-errors";
import { materialsUrl } from "@/providers/data-provider";

/**
 * The material lifecycle (048 EARS-4, EARS-6; `material-lifecycle` of
 * 048-design §Admin):
 *
 * - **«Опубликовать»** on a draft. A refusal (`409 PUBLISH_REQUIREMENTS_NOT_MET`)
 *   names each missing item; the page shows them AT their fields
 *   (`onPublishRefused`) and this panel says one sentence above.
 * - **«Снять с публикации»** on a published material, behind an `AlertDialog`
 *   that says what the act does: the card leaves the feed and the page stops
 *   opening, the text is kept, a later publish restores the first date.
 *
 * Publishing acts on the SAVED version, so the command is held while the form
 * has unsaved edits (`dirty`) — otherwise the operator would publish a text
 * other than the one on screen. Both commands carry the row `version` as
 * `If-Match`; the provider owns the idempotency key and the CSRF proof.
 */
export function MaterialLifecycleActions({
  detail,
  dirty,
  onChanged,
  onPublishRefused,
}: {
  detail: MaterialAdminDetail;
  dirty: boolean;
  /** Re-read the detail: the row's version moved. */
  onChanged: () => void;
  onPublishRefused: (fields: string[]) => void;
}) {
  const t = useTranslations();
  const { mutate, mutation } = useCustomMutation();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const pending = mutation.isPending;

  function run(action: "publish" | "unpublish") {
    setErrorKey(null);
    setNotice(null);
    onPublishRefused([]);
    mutate(
      {
        url: materialsUrl[action](detail.id),
        method: "post",
        // An empty object, not `undefined` — see `PublishAction`: a JSON
        // command POST with no body is refused before the handler runs.
        values: {},
        meta: { version: detail.version },
      },
      {
        onSuccess: () => {
          setConfirming(false);
          setNotice(
            action === "publish"
              ? t("materials.lifecycle.publishedNotice")
              : t("materials.lifecycle.unpublishedNotice"),
          );
          onChanged();
        },
        onError: (error) => {
          setConfirming(false);
          if (action === "publish")
            onPublishRefused(materialRefusedFields(error));
          setErrorKey(
            taxonomyErrorKey(
              error,
              action === "publish"
                ? "materials.errors.publishFailed"
                : "materials.errors.unpublishFailed",
            ),
          );
        },
      },
    );
  }

  const published = detail.status === "published";

  return (
    <div className="flex flex-col gap-3" data-testid="material-lifecycle">
      {errorKey ? (
        <Alert variant="danger" data-testid="material-lifecycle-error">
          {t(errorKey)}
        </Alert>
      ) : notice ? (
        <Alert variant="success" data-testid="material-lifecycle-notice">
          {notice}
        </Alert>
      ) : null}

      <p className="text-sm text-muted-foreground">
        {dirty
          ? t("materials.lifecycle.dirtyHint")
          : published
            ? t("materials.lifecycle.publishedHint")
            : t("materials.lifecycle.draftHint")}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {published ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending || dirty}
            data-testid="material-unpublish"
            onClick={() => setConfirming(true)}
          >
            {t("materials.lifecycle.unpublish")}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            disabled={pending || dirty}
            loading={pending}
            data-testid="material-publish"
            onClick={() => run("publish")}
          >
            {t("materials.lifecycle.publish")}
          </Button>
        )}
      </div>

      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open && !pending) setConfirming(false);
        }}
      >
        <AlertDialogContent data-testid="material-unpublish-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("materials.lifecycle.unpublishTitle", { title: detail.title })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("materials.lifecycle.unpublishDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={pending}
              data-testid="material-unpublish-cancel"
            >
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              data-testid="material-unpublish-submit"
              onClick={(event) => {
                event.preventDefault();
                run("unpublish");
              }}
            >
              {t("materials.lifecycle.unpublishConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
