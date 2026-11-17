"use client";

import { useEffect, useState } from "react";
import { Alert, Button } from "@ds/design-system";

import { createLearningClient } from "../client/index";
import { LEARNING_UI_COPY as C } from "./learning-ui-copy";
import type { PathNode } from "./path-view";

// 024 EARS-14 — the summary of the node the doctor selected on the path, per
// `design-source/doctor-course.dc.html` v16: the card on top of the desktop
// aside and the body of the mobile Sheet. On the aside: where the step sits
// («Урок N · модуль M · шаг s из S · статус»), the title, the step's type and
// meta; in the Sheet (its header names the step and where it sits): the
// lesson's steps (canvas `materials`). Then the lesson's completion sentence
// (EARS-17, from the lesson read), a locked node's reason and the one action
// the node's state allows.

export type SummaryAction = {
  kind: keyof typeof C.summaryActions;
  /** The step route, or the registration door for a guest. */
  href: string;
} | null;

/**
 * The action a selected node offers: a guest → «Открыть» (the sign-up door);
 * a locked node → none (its reason is shown); done → «Повторить»; «Вы здесь» →
 * «Продолжить»; any other open step → «Начать».
 */
export function summaryAction(
  node: PathNode,
  signedIn: boolean,
  hrefs: { step: string; register: string },
): SummaryAction {
  if (node.kind !== "step") return null;
  if (!signedIn) return { kind: "guest", href: hrefs.register };
  if (!node.openable) return null;
  if (node.tone === "done") return { kind: "repeat", href: hrefs.step };
  if (node.here) return { kind: "continue", href: hrefs.step };
  return { kind: "start", href: hrefs.step };
}

/** The lesson's completion sentence, read once per selected lesson. */
function useLessonSentence(lessonId: string | null): string | null {
  const [sentence, setSentence] = useState<{ id: string; text: string } | null>(
    null,
  );
  useEffect(() => {
    if (!lessonId) return;
    let live = true;
    createLearningClient()
      .lesson(lessonId)
      .then((read) => {
        if (live) setSentence({ id: lessonId, text: read.lesson.completionSentence });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [lessonId]);
  return sentence && sentence.id === lessonId ? sentence.text : null;
}

/** A row of the lesson's step list: «2 · Тест · Итоговый тест». */
export interface LessonStepRow {
  no: number;
  label: string;
}

export function NodeSummary({
  node,
  action,
  showTitle = true,
  steps,
}: {
  node: PathNode;
  action: SummaryAction;
  /** false inside the Sheet, whose header already names the node. */
  showTitle?: boolean;
  /** The selected step's lesson, step by step (the Sheet's list). */
  steps?: LessonStepRow[] | undefined;
}) {
  const sentence = useLessonSentence(node.kind === "step" ? node.lessonId : null);
  return (
    <div data-testid="node-summary" className="flex flex-col gap-3">
      {showTitle ? (
        <>
          <div className="text-eyebrow font-extrabold uppercase tracking-eyebrow text-primary-action">
            {node.position ? [node.position, node.status].filter(Boolean).join(" · ") : node.kicker}
          </div>
          <h3 className="m-0 text-lg font-extrabold leading-tight">{node.title}</h3>
          {node.position ? (
            <div className="text-sm font-semibold text-muted-foreground">{node.kicker}</div>
          ) : null}
        </>
      ) : null}
      {steps && steps.length > 0 ? (
        <ol aria-label={C.stepsLabel} className="m-0 flex list-none flex-col border-t border-hairline p-0">
          {steps.map((s) => (
            <li
              key={s.no}
              className="flex items-baseline gap-3 border-b border-hairline py-2 text-sm font-semibold"
            >
              <span className="w-5 flex-none tabular-nums text-faint">{s.no}</span>
              <span>{s.label}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {sentence ? (
        <p className="m-0 text-caption font-semibold leading-prose text-muted-foreground">
          {sentence}
        </p>
      ) : null}
      {node.reason ? <Alert variant="info">{node.reason}</Alert> : null}
      {action ? (
        <div>
          <Button asChild variant={action.kind === "repeat" ? "secondary" : "default"}>
            <a href={action.href}>{C.summaryActions[action.kind]}</a>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
