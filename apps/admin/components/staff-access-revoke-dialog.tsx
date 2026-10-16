"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
} from "@ds/design-system";
import type { StaffAccessRow } from "@ds/schemas";
import {
  revokeRefusal,
  revokeRequestOf,
  STAFF_ACCESS_REVOCATIONS_PATH,
  STAFF_ACCESS_REVOKE_ENDPOINT,
  STAFF_ACCESS_ROUTE,
  staffAccessCells,
  type RevokeRefusal,
} from "@/lib/staff-access";
import {
  browserStepUpStorage,
  saveStepUpRequest,
  stepUpChallengeHref,
} from "@/lib/step-up";
import { adminCsrfToken } from "@/lib/admin-auth";

/** The row being revoked; `replay` — back from the code screen, sent once on open. */
export interface StaffAccessRevokeTarget {
  row: StaffAccessRow;
  replay: boolean;
}

/**
 * 047 EARS-7 — the confirmation of «Отозвать» (approved-non-canvas
 * `feature-047-staff-access-v1`, state `staff-access-revoke-confirm`).
 *
 * `AlertDialog`, destructive action: the revocation ends the person's admin
 * sessions at once (EARS-9) — there is no undo short of a new grant. A failure
 * keeps the dialog open with «Повторить»: a `503` arrives after the sessions
 * were already ended, so the same revocation has to be sent again rather than
 * the row being left looking revoked (the row stays until the list says so).
 * An already-complete revocation (`409`) means the list is stale: close and read
 * it again.
 *
 * The step-up (EARS-8) mirrors the grant form: the first `STEP_UP_REQUIRED`
 * saves the request with the row as its context and goes to the code screen;
 * the page reopens this dialog with `replay` on the way back; a second one on
 * that replay is shown, never looped.
 */
export function StaffAccessRevokeDialog({
  target,
  onClose,
  onRevoked,
}: {
  target: StaffAccessRevokeTarget | null;
  onClose: () => void;
  onRevoked: () => void;
}) {
  const t = useTranslations();
  const router = useRouter();
  const { mutate, mutation } = useCustomMutation();
  const [refusal, setRefusal] = useState<RevokeRefusal | null>(null);
  // An answer for a dialog closed (or reopened on another row) meanwhile is dropped.
  const attempt = useRef(0);

  const row = target?.row ?? null;
  const cells = row ? staffAccessCells(row) : null;

  function close() {
    attempt.current += 1;
    setRefusal(null);
    onClose();
  }

  function send(current: StaffAccessRow, retry: boolean) {
    const body = revokeRequestOf(current);
    const mine = ++attempt.current;
    const live = () => attempt.current === mine;
    setRefusal(null);
    mutate(
      { url: STAFF_ACCESS_REVOCATIONS_PATH, method: "post", values: body },
      {
        onSuccess: () => {
          onRevoked();
          if (live()) close();
        },
        onError: (error) => {
          if (!live()) return;
          const next = revokeRefusal(error);
          if (next.kind === "alreadyComplete") {
            onRevoked();
            close();
            return;
          }
          if (next.kind === "stepUp" && !retry) {
            const href = stepUpChallengeHref(
              next.stepUpUrl,
              STAFF_ACCESS_ROUTE,
              STAFF_ACCESS_REVOKE_ENDPOINT,
            );
            if (href) {
              saveStepUpRequest(
                browserStepUpStorage(),
                {
                  method: "POST",
                  path: STAFF_ACCESS_REVOCATIONS_PATH,
                  body,
                  context: { row: current },
                },
                { owner: adminCsrfToken(), now: Date.now() },
              );
              router.push(href);
              return;
            }
          }
          setRefusal(next);
        },
      },
    );
  }

  // Back from the code screen: the confirmed revocation is sent once.
  const replayed = useRef<StaffAccessRevokeTarget | null>(null);
  useEffect(() => {
    if (!target?.replay || replayed.current === target) return;
    replayed.current = target;
    send(target.row, true);
    // `send` closes over the latest render; this runs once per replay target.
  }, [target]);

  const refusalText = (value: RevokeRefusal): string => {
    switch (value.kind) {
      case "unavailable":
        return t("staffAccess.revoke.errors.unavailable");
      case "selfPlatformAdmin":
        return t("staffAccess.revoke.errors.selfPlatformAdmin");
      case "stepUp":
        return t("staffAccess.revoke.errors.stepUpAgain");
      case "forbidden":
        return t("login.errorForbidden");
      case "invalid":
        return t("staffAccess.revoke.errors.invalid");
      default:
        return t("staffAccess.revoke.errors.generic");
    }
  };

  const pending = mutation.isPending;
  // A refusal that nothing can change offers no «Повторить».
  const final = refusal?.kind === "selfPlatformAdmin";

  return (
    <AlertDialog
      open={row !== null}
      onOpenChange={(open) => {
        if (!open && !pending) close();
      }}
    >
      {row && cells ? (
        <AlertDialogContent data-testid="staff-access-revoke-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("staffAccess.revoke.title", {
                name: cells.fullName || cells.email,
                role: t(cells.roleKey),
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {cells.event
                ? `${t("staffAccess.revoke.eventLine", { event: cells.event })} `
                : ""}
              {t("staffAccess.revoke.consequence")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {refusal ? (
            <Alert
              variant="danger"
              data-testid="staff-access-revoke-error"
              data-refusal={refusal.kind}
            >
              {refusalText(refusal)}
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={pending}
              data-testid="staff-access-revoke-cancel"
            >
              {t("common.cancel")}
            </AlertDialogCancel>
            {final ? null : (
              <AlertDialogAction
                variant="destructive"
                disabled={pending}
                data-testid="staff-access-revoke-submit"
                onClick={(event) => {
                  event.preventDefault();
                  send(row, false);
                }}
              >
                {refusal
                  ? t("staffAccess.revoke.retry")
                  : t("staffAccess.revoke.submit")}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      ) : null}
    </AlertDialog>
  );
}
