"use client";

import { useState } from "react";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Radio,
} from "@ds/design-system";
import type { AdminApplicationOutcome } from "@ds/schemas";

const ADMIN_OUTCOMES: readonly AdminApplicationOutcome[] = [
  "accepted",
  "declined",
];

/**
 * 033 EARS-15 — «Закрыть» (state `application-detail`): the outcome is chosen
 * here, «Принята» or «Отклонена»; «Истекла» is the purge's, never an
 * administrator's (EARS-23). A refusal stays in the dialog; the stale `412`
 * closes it so the page's reload notice speaks.
 */
export function ApplicationCloseDialog({
  open,
  pending,
  error,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (outcome: AdminApplicationOutcome) => void;
}) {
  const t = useTranslations();
  const [outcome, setOutcome] = useState<AdminApplicationOutcome | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (!next) setOutcome(null);
        onOpenChange(next);
      }}
    >
      <DialogContent data-testid="application-close-dialog">
        <DialogHeader>
          <DialogTitle>{t("applications.closeDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("applications.closeDialog.description")}
          </DialogDescription>
        </DialogHeader>
        <fieldset className="flex flex-col gap-2.5">
          <legend className="text-sm font-semibold text-foreground">
            {t("applications.closeDialog.outcomeLabel")}
          </legend>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {ADMIN_OUTCOMES.map((value) => (
              <Radio
                key={value}
                name="application-outcome"
                value={value}
                checked={outcome === value}
                disabled={pending}
                data-testid={`application-outcome-${value}`}
                onChange={() => setOutcome(value)}
              >
                {t(`applications.outcome.${value}`)}
              </Radio>
            ))}
          </div>
        </fieldset>
        {error ? (
          <Alert variant="danger" data-testid="application-close-error">
            {error}
          </Alert>
        ) : null}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            disabled={pending || outcome === null}
            data-testid="application-close-submit"
            onClick={() => {
              if (outcome) onSubmit(outcome);
            }}
          >
            {t("applications.closeDialog.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 033 EARS-20 — «Стереть персональные данные заявителя» (state
 * `application-erase`): a destructive confirmation naming what is erased and
 * what stays. There is no undo, so the dialog is an `AlertDialog`.
 */
export function ApplicationEraseDialog({
  open,
  pending,
  error,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  pending: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const t = useTranslations();
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <AlertDialogContent data-testid="application-erase-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("applications.erase.title")}</AlertDialogTitle>
          <AlertDialogDescription data-testid="application-erase-what">
            {t("applications.erase.erased")}
          </AlertDialogDescription>
          <p
            className="text-sm text-muted-foreground"
            data-testid="application-erase-kept"
          >
            {t("applications.erase.kept")}
          </p>
        </AlertDialogHeader>
        {error ? (
          <Alert variant="danger" data-testid="application-erase-error">
            {error}
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {t("common.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            data-testid="application-erase-submit"
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {t("applications.erase.submit")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
