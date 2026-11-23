"use client";

import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Radio,
} from "@ds/design-system";
import type {
  LearningPreset,
  LearningScopeRules,
  LearningSettingKey,
} from "@ds/schemas";

import {
  ADMIN_COPY as C,
  SETTING_LABEL,
  settingValueInWords,
} from "./admin-copy";
import { authorityRefusal, isStale, refusedFieldLines } from "./refusals";
import type { LearningAdminTransport } from "./transport";

// 024 EARS-29 slice 1 — «Применить пресет» on a course: the presets are the
// API's data (`GET /v1/admin/learning/presets`), each shown with the settings
// it sets in words; applying one writes the course layer under its version and
// keeps every lower override (EARS-9, server-proven). On a school too (the
// rules editor's school scope); a staff member without the scope's authority
// (EARS-30) sees the choice read-only, and a 403 is named.

export function PresetPanel({
  scopeKind,
  scopeId,
  transport,
  readOnly = false,
  onApplied,
}: {
  scopeKind: "school" | "course";
  scopeId: string;
  transport: LearningAdminTransport;
  /** EARS-30 — the staff member may not change this scope: the choice is shown, not offered. */
  readOnly?: boolean;
  /** The scope's rules after an apply, for a screen that shows them too. */
  onApplied?: (rules: LearningScopeRules) => void;
}) {
  const [presets, setPresets] = useState<LearningPreset[] | null>(null);
  const [rules, setRules] = useState<LearningScopeRules | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [refused, setRefused] = useState<string[] | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([transport.presets(), transport.rules(scopeKind, scopeId)])
      .then(([p, r]) => {
        if (!live) return;
        setPresets(p);
        setRules(r);
        // The picker starts on the preset the course has applied (the read
        // names it), so the choice on screen is the one in force.
        setChosen(p.find((x) => x.name === r.appliedPreset)?.id ?? null);
      })
      .catch(() => live && setRefused([C.loadFailed]));
    return () => {
      live = false;
    };
  }, [scopeKind, scopeId, transport]);

  async function apply() {
    const preset = presets?.find((p) => p.id === chosen);
    if (!preset || !rules) return;
    setBusy(true);
    setDone(null);
    setRefused(null);
    try {
      const applied = await transport.applyPreset(
        scopeKind,
        scopeId,
        preset.id,
        rules.layerVersion,
      );
      setRules(applied);
      onApplied?.(applied);
      setDone(C.presetDone(preset.name, scopeKind));
    } catch (error) {
      if (isStale(error)) {
        setRefused([C.stale]);
        setRules(await transport.rules(scopeKind, scopeId).catch(() => rules));
      } else {
        const lines = refusedFieldLines(error);
        const reason = authorityRefusal(error, scopeKind);
        setRefused(reason ? [reason] : lines.length > 0 ? lines : [C.failed]);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="preset-heading" data-testid="preset-panel">
      <Card>
        <CardHeader>
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
            <h2
              id="preset-heading"
              className="text-lg font-bold text-foreground"
            >
              {C.presetHeading}
            </h2>
            {rules?.appliedPreset ? (
              <Badge variant="success">
                {C.presetApplied(rules.appliedPreset)}
              </Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">{C.presetHint}</p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            {done ? <Alert variant="success">{done}</Alert> : null}
            {refused ? (
              <Alert variant="danger" data-testid="write-refusal">
                <ul className="list-disc pl-5">
                  {refused.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </Alert>
            ) : null}
            {presets && presets.length === 0 ? (
              <p className="text-sm text-muted-foreground">{C.presetEmpty}</p>
            ) : null}
            <fieldset className="flex flex-col gap-3">
              <legend className="sr-only">{C.presetHeading}</legend>
              {(presets ?? []).map((preset) => (
                <div
                  key={preset.id}
                  data-testid={`preset-${preset.id}`}
                  className="flex flex-col gap-2 border-t border-border pt-3"
                >
                  <Radio
                    name="course-preset"
                    value={preset.id}
                    checked={chosen === preset.id}
                    disabled={readOnly}
                    onChange={() => setChosen(preset.id)}
                  >
                    <span className="font-bold text-foreground">
                      {preset.name}
                    </span>
                  </Radio>
                  <ul className="flex flex-col gap-1 pl-8 text-sm text-muted-foreground">
                    {(
                      Object.entries(preset.values) as [
                        LearningSettingKey,
                        unknown,
                      ][]
                    ).map(([key, value]) => (
                      <li key={key}>
                        {SETTING_LABEL[key]}: {settingValueInWords(key, value)}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </fieldset>
            <div>
              <Button
                disabled={readOnly || busy || !chosen || !rules}
                onClick={() => void apply()}
              >
                {C.applyPreset}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
