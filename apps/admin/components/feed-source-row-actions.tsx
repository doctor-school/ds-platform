"use client";

import { useState } from "react";
import Link from "next/link";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@ds/design-system";
import type { FeedSourceAdmin } from "@ds/schemas";
import { FeedSourceForm } from "@/components/feed-source-form";
import {
  feedSourceErrorKey,
  feedSourceAddressRefusal,
} from "@/lib/feed-source-errors";
import { feedSourcesUrl } from "@/providers/data-provider";

/**
 * The row actions of «Источники» (048 EARS-21, EARS-22, EARS-32):
 *
 * - **«Публикации»** opens the source's posts (EARS-32).
 * - **«Изменить адрес»** opens the address form in a `Dialog`; a refused
 *   address is marked at the field with the typed value kept, and nothing is
 *   stored. The PATCH carries the row `version` the list rendered as
 *   `If-Match`, so a row another operator moved meanwhile is a 412, never a
 *   lost edit.
 * - **«Выключить»** behind an `AlertDialog` that says what the act does (the
 *   posts leave the feed, stay listed here, new posts are not taken);
 *   **«Включить»** acts at once — it only gives the feed back what it had.
 *
 * The provider's `custom` path owns the Idempotency-Key, If-Match and CSRF
 * headers; the page re-reads the list after every outcome.
 */
export function FeedSourceRowActions({
  source,
  onStarted,
  onChanged,
  onFailed,
}: {
  source: FeedSourceAdmin;
  onStarted: () => void;
  /** The success sentence; the page re-reads the list. */
  onChanged: (message: string) => void;
  /** The failure sentence of a switch command; the page re-reads the list. */
  onFailed: (message: string) => void;
}) {
  const t = useTranslations();
  const { mutate, mutation } = useCustomMutation();
  const [editing, setEditing] = useState(false);
  const [confirmingOff, setConfirmingOff] = useState(false);
  const [editErrorKey, setEditErrorKey] = useState<string | null>(null);
  const [addressRefusal, setAddressRefusal] = useState<string | null>(null);
  const pending = mutation.isPending;
  const label = `t.me/${source.address}`;

  function switchState(command: "disable" | "enable") {
    onStarted();
    mutate(
      {
        url: feedSourcesUrl.command(source.id, command),
        method: "post",
        // A JSON command POST with no body is refused before the handler runs.
        values: {},
        meta: { version: source.version },
      },
      {
        onSuccess: () => {
          setConfirmingOff(false);
          onChanged(
            t(
              command === "disable"
                ? "feedSources.notices.disabled"
                : "feedSources.notices.enabled",
              { address: label },
            ),
          );
        },
        onError: (error) => {
          setConfirmingOff(false);
          onFailed(
            t(
              feedSourceErrorKey(
                error,
                command === "disable"
                  ? "feedSources.errors.disableFailed"
                  : "feedSources.errors.enableFailed",
              ),
            ),
          );
        },
      },
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="outline" size="sm">
        <Link
          href={`/materials/sources/${source.id}`}
          aria-label={t("feedSources.actions.postsOf", { address: label })}
          data-testid={`feed-source-posts-${source.address}`}
        >
          {t("feedSources.actions.posts")}
        </Link>
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        aria-label={t("feedSources.actions.editAddressOf", { address: label })}
        data-testid={`feed-source-edit-${source.address}`}
        onClick={() => {
          onStarted();
          setEditErrorKey(null);
          setAddressRefusal(null);
          setEditing(true);
        }}
      >
        {t("feedSources.actions.editAddress")}
      </Button>
      {source.enabled ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          aria-label={t("feedSources.actions.disableOf", { address: label })}
          data-testid={`feed-source-disable-${source.address}`}
          onClick={() => setConfirmingOff(true)}
        >
          {t("feedSources.actions.disable")}
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          disabled={pending}
          loading={pending}
          aria-label={t("feedSources.actions.enableOf", { address: label })}
          data-testid={`feed-source-enable-${source.address}`}
          onClick={() => switchState("enable")}
        >
          {t("feedSources.actions.enable")}
        </Button>
      )}

      <Dialog
        open={editing}
        onOpenChange={(open) => {
          if (!open && !pending) setEditing(false);
        }}
      >
        <DialogContent data-testid="feed-source-edit-dialog">
          <DialogHeader>
            <DialogTitle>{t("feedSources.editTitle")}</DialogTitle>
            <DialogDescription>
              {t("feedSources.editDescription", { address: label })}
            </DialogDescription>
          </DialogHeader>
          {editErrorKey ? (
            <Alert variant="danger" data-testid="feed-source-edit-error">
              {t(editErrorKey)}
            </Alert>
          ) : null}
          <FeedSourceForm
            mode="edit"
            defaultAddress={source.address}
            submitLabel={t("common.save")}
            cancelLabel={t("feedSources.actions.cancel")}
            onCancel={() => setEditing(false)}
            submitting={pending}
            addressRefusal={addressRefusal}
            onSubmit={(values) => {
              setEditErrorKey(null);
              setAddressRefusal(null);
              mutate(
                {
                  url: feedSourcesUrl.row(source.id),
                  method: "patch",
                  values: { address: values.address },
                  meta: { version: source.version },
                },
                {
                  onSuccess: () => {
                    setEditing(false);
                    onChanged(t("feedSources.notices.addressChanged"));
                  },
                  onError: (error) => {
                    // A refusal addressed to the address is shown ON the field
                    // only; the banner is for failures no field owns.
                    const refusal = feedSourceAddressRefusal(error);
                    setAddressRefusal(refusal);
                    setEditErrorKey(
                      refusal
                        ? null
                        : feedSourceErrorKey(
                            error,
                            "feedSources.errors.editFailed",
                          ),
                    );
                  },
                },
              );
            }}
          />
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmingOff}
        onOpenChange={(open) => {
          if (!open && !pending) setConfirmingOff(false);
        }}
      >
        <AlertDialogContent data-testid="feed-source-disable-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("feedSources.disableConfirm.title", { address: label })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("feedSources.disableConfirm.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>
              {t("feedSources.actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="feed-source-disable-confirm"
              disabled={pending}
              onClick={(event) => {
                // Keep the dialog open until the command answers.
                event.preventDefault();
                switchState("disable");
              }}
            >
              {t("feedSources.actions.disable")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
