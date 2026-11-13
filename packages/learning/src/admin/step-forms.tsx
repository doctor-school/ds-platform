"use client";

import { useState, type FormEvent } from "react";
import {
  Button,
  Input,
  Label,
  NativeSelect,
  Radio,
  Textarea,
} from "@ds/design-system";
import {
  FormActions,
  FormFieldGroup,
  FormSection,
} from "@ds/design-system/blocks";
import {
  LEARNING_ELEMENT_TYPES,
  LEARNING_STEP_INPUTS,
  LearningTestPayloadSchema,
  STREAM_PROVIDERS,
  type CreateLearningStepRequest,
  type LearningElementType,
  type LearningStepAdmin,
  type SetLearningStepSourceRequest,
  type StreamProvider,
} from "@ds/schemas";

import { STEP_TYPE_LABEL } from "../ui/learning-ui-copy";
import { ADMIN_COPY as C } from "./admin-copy";

// 024 EARS-28 (slice 1) — the step inputs of the composition screen. The type
// list is the catalog's (`LEARNING_ELEMENT_TYPES`), the inputs a type takes
// besides its payload come from `LEARNING_STEP_INPUTS` (a provider source, an
// uploaded file), and the test's kind is the payload schema's own literal.

const EXIT_KIND = LearningTestPayloadSchema.shape.kind.value;

interface QuestionDraft {
  text: string;
  options: string[];
  correct: number;
}

const emptyQuestion = (): QuestionDraft => ({
  text: "",
  options: ["", ""],
  correct: -1,
});

/** The payload of a new step, built from the type's own fields. */
function payloadOf(
  type: LearningElementType,
  fields: { videoSec: string; fileName: string; questions: QuestionDraft[] },
): unknown {
  switch (type) {
    case "video":
      return { durationSec: Number(fields.videoSec) };
    case "download":
      return { fileName: fields.fileName };
    case "test":
      return {
        kind: EXIT_KIND,
        questions: fields.questions.map((q) => ({
          text: q.text,
          options: q.options.map((text, i) => ({
            text,
            correct: i === q.correct,
          })),
        })),
      };
  }
}

export function AddStepForm({
  lessonId,
  busy,
  onAdd,
}: {
  lessonId: string;
  busy: boolean;
  onAdd: (body: CreateLearningStepRequest) => Promise<boolean>;
}) {
  const [type, setType] = useState<LearningElementType>(
    LEARNING_ELEMENT_TYPES[0],
  );
  const [title, setTitle] = useState("");
  const [durationMin, setDurationMin] = useState("");
  const [videoSec, setVideoSec] = useState("");
  const [fileName, setFileName] = useState("");
  const [questions, setQuestions] = useState<QuestionDraft[]>([
    emptyQuestion(),
  ]);

  const setQuestion = (qi: number, next: Partial<QuestionDraft>) =>
    setQuestions((qs) => qs.map((q, i) => (i === qi ? { ...q, ...next } : q)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const added = await onAdd({
      lessonId,
      type,
      title,
      durationMin: Number(durationMin),
      payload: payloadOf(type, { videoSec, fileName, questions }),
    });
    if (added) {
      setTitle("");
      setDurationMin("");
      setVideoSec("");
      setFileName("");
      setQuestions([emptyQuestion()]);
    }
  }

  return (
    <form onSubmit={submit} data-testid="add-step-form">
      <FormSection legend={C.newStep} description={C.newStepHint}>
        <FormFieldGroup>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-step-type">{C.stepType}</Label>
            <NativeSelect
              id="new-step-type"
              value={type}
              onChange={(e) => setType(e.target.value as LearningElementType)}
            >
              {LEARNING_ELEMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {STEP_TYPE_LABEL[t]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-step-title">{C.stepTitle}</Label>
            <Input
              id="new-step-title"
              value={title}
              required
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-step-duration">{C.stepDuration}</Label>
            <Input
              id="new-step-duration"
              type="number"
              min={1}
              inputMode="numeric"
              value={durationMin}
              required
              onChange={(e) => setDurationMin(e.target.value)}
            />
          </div>
          {type === "video" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-step-video-sec">{C.videoLength}</Label>
              <Input
                id="new-step-video-sec"
                type="number"
                min={1}
                inputMode="numeric"
                value={videoSec}
                required
                onChange={(e) => setVideoSec(e.target.value)}
              />
            </div>
          ) : null}
          {type === "download" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-step-file-name">{C.fileName}</Label>
              <Input
                id="new-step-file-name"
                value={fileName}
                required
                onChange={(e) => setFileName(e.target.value)}
              />
            </div>
          ) : null}
        </FormFieldGroup>
        {type === "test"
          ? questions.map((q, qi) => (
              <div
                key={qi}
                className="flex flex-col gap-3 border-t border-border pt-4"
                data-testid={`question-${qi + 1}`}
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`q-${qi}`}>{C.question(qi + 1)}</Label>
                  <Textarea
                    id={`q-${qi}`}
                    value={q.text}
                    required
                    onChange={(e) => setQuestion(qi, { text: e.target.value })}
                  />
                </div>
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-sm text-muted-foreground">
                    {C.correctLegend(qi + 1)}
                  </legend>
                  {q.options.map((text, oi) => (
                    <div key={oi} className="flex items-center gap-3">
                      <Radio
                        name={`q-${qi}-correct`}
                        checked={q.correct === oi}
                        aria-label={C.optionCorrect(qi + 1, oi + 1)}
                        onChange={() => setQuestion(qi, { correct: oi })}
                      />
                      <Input
                        aria-label={C.option(qi + 1, oi + 1)}
                        value={text}
                        required
                        onChange={(e) =>
                          setQuestion(qi, {
                            options: q.options.map((o, i) =>
                              i === oi ? e.target.value : o,
                            ),
                          })
                        }
                      />
                    </div>
                  ))}
                </fieldset>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setQuestion(qi, { options: [...q.options, ""] })
                    }
                  >
                    {C.addOption}
                  </Button>
                  {questions.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setQuestions((qs) => qs.filter((_, i) => i !== qi))
                      }
                    >
                      {C.removeQuestion(qi + 1)}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))
          : null}
        {type === "test" ? (
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setQuestions((qs) => [...qs, emptyQuestion()])}
            >
              {C.addQuestion}
            </Button>
          </div>
        ) : null}
      </FormSection>
      <FormActions>
        <Button type="submit" disabled={busy}>
          {C.addStep}
        </Button>
      </FormActions>
    </form>
  );
}

/** A provider-sourced step's source (006 provider + embed reference). */
export function StepSourceForm({
  step,
  busy,
  providerLabels,
  onSave,
}: {
  step: LearningStepAdmin;
  busy: boolean;
  providerLabels: Record<StreamProvider, string>;
  onSave: (body: SetLearningStepSourceRequest) => void;
}) {
  const [provider, setProvider] = useState<StreamProvider>(
    step.source?.provider ?? STREAM_PROVIDERS[0],
  );
  const [embedRef, setEmbedRef] = useState(step.source?.embedRef ?? "");
  if (!LEARNING_STEP_INPUTS[step.type].providerSource) return null;
  const id = `step-${step.id}`;
  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ provider, embedRef });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-provider`}>{C.provider}</Label>
        <NativeSelect
          id={`${id}-provider`}
          value={provider}
          onChange={(e) => setProvider(e.target.value as StreamProvider)}
        >
          {STREAM_PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {providerLabels[p]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Label htmlFor={`${id}-embed`}>{C.embedRef}</Label>
        <Input
          id={`${id}-embed`}
          value={embedRef}
          required
          onChange={(e) => setEmbedRef(e.target.value)}
        />
      </div>
      <Button type="submit" size="field" variant="outline" disabled={busy}>
        {C.saveSource}
      </Button>
    </form>
  );
}

/** A step type's uploaded file under the 012 media contract. */
export function StepFileForm({
  step,
  busy,
  onUpload,
}: {
  step: LearningStepAdmin;
  busy: boolean;
  onUpload: (file: File) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const rule = LEARNING_STEP_INPUTS[step.type].media;
  if (!rule) return null;
  const id = `step-${step.id}-file`;
  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        if (file) onUpload(file);
      }}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Label htmlFor={id}>{C.file}</Label>
        <Input
          id={id}
          type="file"
          accept={rule.contentTypes.join(",")}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>
      <Button
        type="submit"
        size="field"
        variant="outline"
        disabled={busy || !file}
      >
        {C.upload}
      </Button>
    </form>
  );
}
