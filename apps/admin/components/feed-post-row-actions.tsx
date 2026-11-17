"use client";

import { useState } from "react";
import { useCustomMutation } from "@refinedev/core";
import { useTranslations } from "next-intl";
import {
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
import type { FeedEntryAdmin } from "@ds/schemas";
import { feedEntryErrorKey } from "@/lib/feed-source-errors";
import { feedSourcesUrl } from "@/providers/data-provider";

/**
 * The row action of «Публикации» (048 EARS-32):
 *
 * - **«Скрыть из ленты»** behind an `AlertDialog` that says what the act does
 *   (the post leaves the Academy feed and stays in Telegram);
 * - **«Вернуть в ленту»** acts at once — it only gives the feed back a post
 *   it had, at its own date.
 *
 * The command carries the row `version` the list rendered as `If-Match`, so a
 * post an edit from the channel moved meanwhile is a 412, never a blind
 * write. The provider's `custom` path owns the Idempotency-Key, If-Match and
 * CSRF headers; the page re-reads the list after every outcome.
 */
export function FeedPostRowActions({
  entry,
  dateLabel,
  onStarted,
  onChanged,
  onFailed,
}: {
  entry: FeedEntryAdmin;
  /** The row's date as the page shows it — names the post to a screen reader. */
  dateLabel: string;
  onStarted: () => void;
  /** The success sentence; the page re-reads the list. */
  onChanged: (message: string) => void;
  /** The failure sentence; the page re-reads the list. */
  onFailed: (message: string) => void;
}) {
  const t = useTranslations();
  const { mutate, mutation } = useCustomMutation();
  const [confirming, setConfirming] = useState(false);
  const pending = mutation.isPending;

  function run(command: "hide" | "unhide") {
    onStarted();
    mutate(
      {
        url: feedSourcesUrl.entryCommand(entry.id, command),
        method: "post",
        // A JSON command POST with no body is refused before the handler runs.
        values: {},
        meta: { version: entry.version },
      },
      {
        onSuccess: () => {
          setConfirming(false);
          onChanged(
            t(
              command === "hide"
                ? "feedPosts.notices.hidden"
                : "feedPosts.notices.unhidden",
            ),
          );
        },
        onError: (error) => {
          setConfirming(false);
          onFailed(
            t(
              feedEntryErrorKey(
                error,
                command === "hide"
                  ? "feedPosts.errors.hideFailed"
                  : "feedPosts.errors.unhideFailed",
              ),
            ),
          );
        },
      },
    );
  }

  return (
    <>
      {entry.hidden ? (
        <Button
          type="button"
          size="sm"
          disabled={pending}
          loading={pending}
          aria-label={t("feedPosts.actions.unhideOf", { date: dateLabel })}
          data-testid={`feed-post-unhide-${entry.id}`}
          onClick={() => run("unhide")}
        >
          {t("feedPosts.actions.unhide")}
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          aria-label={t("feedPosts.actions.hideOf", { date: dateLabel })}
          data-testid={`feed-post-hide-${entry.id}`}
          onClick={() => setConfirming(true)}
        >
          {t("feedPosts.actions.hide")}
        </Button>
      )}

      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open && !pending) setConfirming(false);
        }}
      >
        <AlertDialogContent data-testid="feed-post-hide-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("feedPosts.hideConfirm.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("feedPosts.hideConfirm.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>
              {t("feedPosts.actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="feed-post-hide-confirm"
              disabled={pending}
              onClick={(event) => {
                // Keep the dialog open until the command answers.
                event.preventDefault();
                run("hide");
              }}
            >
              {t("feedPosts.actions.hide")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
