"use client";

import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Radio,
} from "@ds/design-system";
import type {
  LearningEarnedProgress,
  LearningRuleChangePreview,
} from "@ds/schemas";

import { RULES_COPY as R } from "./admin-copy";

// 024 EARS-31, owner D16 — the change dialog of a rule change on a
// once-published course (a save or a preset apply): the number of doctors
// whose statuses would change (the server's preview, nothing written) and the
// choice «Сохранить заработанные зачёты» (preselected) or «Потребовать заново».

export function RuleChangeDialog({
  preview,
  onConfirm,
  onCancel,
}: {
  /** Open while non-null. */
  preview: LearningRuleChangePreview | null;
  onConfirm: (earned: LearningEarnedProgress) => void;
  onCancel: () => void;
}) {
  const [earned, setEarned] = useState<LearningEarnedProgress>("keep");
  // Every opening starts on «keep» (D16).
  useEffect(() => {
    if (preview) setEarned("keep");
  }, [preview]);
  return (
    <AlertDialog
      open={preview !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent data-testid="rule-change-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{R.dialogTitle}</AlertDialogTitle>
          <AlertDialogDescription>
            {R.impact(preview?.affectedDoctors ?? 0)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {preview && preview.affectedDoctors > 0 ? (
          <p className="text-sm text-muted-foreground">
            {R.impactDetail(preview.toDone, preview.toNotDone)}
          </p>
        ) : null}
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-bold text-foreground">
            {R.earnedLegend}
          </legend>
          <Radio
            name="earned-progress"
            value="keep"
            checked={earned === "keep"}
            onChange={() => setEarned("keep")}
          >
            {R.keep}
          </Radio>
          <p className="pl-8 text-sm text-muted-foreground">{R.keepHint}</p>
          <Radio
            name="earned-progress"
            value="require-again"
            checked={earned === "require-again"}
            onChange={() => setEarned("require-again")}
          >
            {R.requireAgain}
          </Radio>
          <p className="pl-8 text-sm text-muted-foreground">
            {R.requireAgainHint}
          </p>
        </fieldset>
        <AlertDialogFooter>
          <AlertDialogCancel>{R.cancel}</AlertDialogCancel>
          <AlertDialogAction onClick={() => onConfirm(earned)}>
            {R.apply}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
