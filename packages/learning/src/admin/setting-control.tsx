"use client";

import { useId } from "react";
import {
  Checkbox,
  Input,
  Label,
  NativeSelect,
  Switch,
} from "@ds/design-system";
import type {
  LearningRuleNode,
  LearningSettingKey,
  LearningUnlock,
} from "@ds/schemas";

import {
  RULES_COPY as R,
  SETTING_LABEL,
  SETTING_OPTIONS,
  UNLOCK_KIND_LABEL,
} from "./admin-copy";
import { RuleBuilder } from "./rule-builder";

// 024 EARS-6…8, EARS-29 — one setting's control, by the value schema of its key
// (`LEARNING_SETTING_SCHEMAS`): a rule tree, an unlock, an enum, a yes/no, a
// number, or a number with its «без ограничений» / «все» alternative. The
// control's accessible name is the setting's label. The server validator stays
// the authority over a value; a refusal names the setting.

const BOOLEAN_KEYS = new Set<LearningSettingKey>([
  "test.exitRequired",
  "test.entryRequired",
  "test.entryCounts",
  "testOut.allowed",
  "repeat.allowed",
  "course.closingClub",
  "course.clubInCompletion",
]);

/** The number a field holds, or the raw text when it is not one (the server refuses it, by name). */
const numberOr = (raw: string): number | string =>
  raw.trim() === "" || Number.isNaN(Number(raw)) ? raw : Number(raw);

export function SettingControl({
  settingKey: key,
  value,
  onChange,
}: {
  settingKey: LearningSettingKey;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const id = useId();
  const label = SETTING_LABEL[key];

  if (key.startsWith("completion."))
    return (
      <RuleBuilder
        value={value as LearningRuleNode}
        onChange={(next) => onChange(next)}
      />
    );

  if (key === "unlock") {
    const u = value as LearningUnlock;
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-kind`}>{label}</Label>
          <NativeSelect
            id={`${id}-kind`}
            value={u.kind}
            onChange={(e) => {
              const kind = e.target.value;
              if (kind === "from-date")
                onChange({ kind, instant: new Date().toISOString() });
              else if (kind === "expression")
                onChange({ kind, rule: { condition: "lessons-done" } });
              else onChange({ kind });
            }}
          >
            {Object.entries(UNLOCK_KIND_LABEL).map(([k, words]) => (
              <option key={k} value={k}>
                {words}
              </option>
            ))}
          </NativeSelect>
        </div>
        {u.kind === "from-date" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-date`}>{R.date}</Label>
            <Input
              id={`${id}-date`}
              type="date"
              value={u.instant.slice(0, 10)}
              onChange={(e) =>
                e.target.value &&
                onChange({
                  kind: "from-date",
                  instant: new Date(`${e.target.value}T00:00:00Z`).toISOString(),
                })
              }
            />
          </div>
        ) : null}
        {u.kind === "expression" ? (
          <RuleBuilder
            value={u.rule}
            onChange={(rule) => onChange({ kind: "expression", rule })}
          />
        ) : null}
      </div>
    );
  }

  const options = SETTING_OPTIONS[key];
  if (options)
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        <NativeSelect
          id={id}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        >
          {Object.entries(options).map(([v, words]) => (
            <option key={v} value={v}>
              {words}
            </option>
          ))}
        </NativeSelect>
      </div>
    );

  if (BOOLEAN_KEYS.has(key))
    return (
      <Switch
        checked={value === true}
        onChange={(e) => onChange(e.target.checked)}
      >
        {label}
      </Switch>
    );

  // A number, or a number with a word alternative.
  const alternative =
    key === "test.attempts"
      ? { word: "unlimited", label: R.unlimited }
      : key === "test.questions"
        ? { word: "all", label: R.allQuestions }
        : null;
  const isWord = alternative !== null && value === alternative.word;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          type="number"
          step={key === "progress.maxPlaybackRate" ? 0.25 : 1}
          disabled={isWord}
          value={isWord ? "" : String(value ?? "")}
          onChange={(e) => onChange(numberOr(e.target.value))}
        />
      </div>
      {alternative ? (
        <Checkbox
          checked={isWord}
          onChange={(e) => onChange(e.target.checked ? alternative.word : 1)}
        >
          {alternative.label}
        </Checkbox>
      ) : null}
    </div>
  );
}
