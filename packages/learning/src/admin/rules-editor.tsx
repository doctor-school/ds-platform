"use client";

import { useCallback, useEffect, useId, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Label,
  NativeSelect,
  Skeleton,
} from "@ds/design-system";
import type {
  LearningEarnedProgress,
  LearningPreset,
  LearningRuleChangePreview,
  LearningScopeKind,
  LearningScopeRules,
  LearningSettingKey,
  LearningSettingValues,
} from "@ds/schemas";

import {
  ADMIN_COPY as C,
  RULES_COPY as R,
  SETTING_LABEL,
  SETTING_SECTIONS,
  settingValueInWords,
} from "./admin-copy";
import { readOnlyReason } from "./authority";
import { PresetPanel } from "./preset-panel";
import { authorityRefusal, isStale, rulesRefusalLines } from "./refusals";
import { RuleChangeDialog } from "./rule-change-dialog";
import { SettingControl } from "./setting-control";
import { settingValues } from "./setting-values";
import type { LearningAdminTransport } from "./transport";

// 024 EARS-29 — the rules editor of one scope (platform, school, course,
// module, lesson, step): every setting of EARS-6…8 with its effective value and
// where it comes from, an override and «Вернуть унаследованное» per setting,
// the completion-rule builder, «Применить пресет» at a school or course, and
// the presets' contents on the platform scope. EARS-30 — the read names the
// scope's authority; a staff member without it sees the rules read-only with
// the reason, and a 403 still lands there. EARS-31 — a save on a scope a
// once-published course resolves through first asks the server how many
// doctors' statuses would change, then applies the chosen «keep» /
// «require-again» under the version the screen rendered from.

export interface RulesEditorScreenProps {
  scopeKind: LearningScopeKind;
  scopeId: string;
  transport: LearningAdminTransport;
  /** The signed-in staff member's roles (the admin session read). */
  staffRoles: readonly string[];
}

/** Equal value maps regardless of key order. */
function sameValues(a: object, b: object): boolean {
  const canon = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canon)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v as object)
              .sort()
              .map((k) => [k, canon((v as Record<string, unknown>)[k])]),
          )
        : v;
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

const clone = <T,>(v: T): T =>
  v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);

export function RulesEditorScreen({
  scopeKind,
  scopeId,
  transport,
  staffRoles,
}: RulesEditorScreenProps) {
  const [rules, setRules] = useState<LearningScopeRules | null>(null);
  const [draft, setDraft] = useState<LearningSettingValues>({});
  const [editing, setEditing] = useState<Set<LearningSettingKey>>(new Set());
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [refused, setRefused] = useState<string[] | null>(null);
  const [deniedReason, setDeniedReason] = useState<string | null>(null);
  const [preview, setPreview] = useState<LearningRuleChangePreview | null>(
    null,
  );

  const show = useCallback((next: LearningScopeRules) => {
    setRules(next);
    setDraft(settingValues(next.values));
    setEditing(new Set());
  }, []);

  const load = useCallback(async () => {
    try {
      show(await transport.rules(scopeKind, scopeId));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [scopeKind, scopeId, transport, show]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadFailed)
    return (
      <Alert variant="danger" data-testid="rules-load-error">
        {C.loadFailed}{" "}
        <Button variant="link" onClick={() => void load()}>
          {C.retry}
        </Button>
      </Alert>
    );
  if (!rules)
    return (
      <div aria-busy="true" aria-label={C.loading} className="h-24 w-full">
        <Skeleton className="h-full w-full" />
      </div>
    );

  const current = rules;
  const reason =
    deniedReason ??
    readOnlyReason(scopeKind, current.authority, staffRoles);
  const canEdit = reason === null;
  const dirty = !sameValues(draft, current.values);
  // EARS-31 — a scope a once-published course resolves through (and the
  // platform layer) takes the rules editor; its save is a rule change.
  const isRuleChange = current.authority === "rules-editor";

  function override(key: LearningSettingKey) {
    const effective = current.effective.find((e) => e.key === key);
    setDraft((d) =>
      Object.hasOwn(d, key) ? d : { ...d, [key]: clone(effective?.value) },
    );
    setEditing((s) => new Set(s).add(key));
  }

  function revert(key: LearningSettingKey) {
    setDraft((d) => {
      const { [key]: _gone, ...rest } = d;
      return rest;
    });
    setEditing((s) => {
      const next = new Set(s);
      next.delete(key);
      return next;
    });
  }

  function refuse(error: unknown) {
    const denied = authorityRefusal(error, scopeKind);
    if (denied) {
      setDeniedReason(denied);
      return;
    }
    const lines = rulesRefusalLines(error);
    setRefused(lines.length > 0 ? lines : [C.failed]);
  }

  async function save() {
    setDone(null);
    setRefused(null);
    if (!isRuleChange) return commit(undefined);
    setBusy(true);
    try {
      setPreview(await transport.previewRules(scopeKind, scopeId, draft));
    } catch (error) {
      if (authorityRefusal(error, scopeKind) || rulesRefusalLines(error).length)
        refuse(error);
      else setRefused([R.previewFailed]);
    } finally {
      setBusy(false);
    }
  }

  async function commit(earnedProgress: LearningEarnedProgress | undefined) {
    setPreview(null);
    setBusy(true);
    try {
      show(
        await transport.setRules(
          scopeKind,
          scopeId,
          earnedProgress
            ? { values: draft, earnedProgress }
            : { values: draft },
          current.layerVersion,
        ),
      );
      setDone(R.saved);
    } catch (error) {
      if (isStale(error)) {
        setRefused([R.stale]);
        await load();
      } else refuse(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6" data-testid="rules-editor">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-extrabold text-foreground">
          {R.heading(scopeKind)}
        </h1>
        <p className="text-sm text-muted-foreground">{R.hint}</p>
      </header>

      {reason ? (
        <Alert variant="info" data-testid="rules-read-only">
          {reason}
        </Alert>
      ) : null}
      {done ? <Alert variant="success">{done}</Alert> : null}
      {refused ? (
        <Alert variant="danger" data-testid="write-refusal">
          <p className="font-bold">{R.refused}</p>
          <ul className="mt-1 list-disc pl-5">
            {refused.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {scopeKind === "school" || scopeKind === "course" ? (
        <PresetPanel
          scopeKind={scopeKind}
          scopeId={scopeId}
          transport={transport}
          readOnly={!canEdit}
          heldByDraft={dirty}
          current={current}
          onApplied={show}
        />
      ) : null}

      {SETTING_SECTIONS.map((section) => (
        <section
          key={section.title}
          aria-label={section.title}
          className="flex flex-col gap-3"
        >
          <h2 className="text-lg font-bold text-foreground">{section.title}</h2>
          <ul className="flex flex-col">
            {section.keys.map((key) => (
              <SettingRow
                key={key}
                settingKey={key}
                scopeKind={scopeKind}
                rules={current}
                draft={draft}
                editing={editing.has(key)}
                canEdit={canEdit}
                onOverride={() => override(key)}
                onRevert={() => revert(key)}
                onChange={(value) => setDraft((d) => ({ ...d, [key]: value }))}
              />
            ))}
          </ul>
        </section>
      ))}

      {canEdit ? (
        <div className="flex flex-wrap gap-3">
          <Button disabled={busy || !dirty} onClick={() => void save()}>
            {R.save}
          </Button>
          <Button
            variant="outline"
            disabled={busy || !dirty}
            onClick={() => show(current)}
          >
            {R.discard}
          </Button>
        </div>
      ) : null}

      {scopeKind === "platform" ? (
        <PresetContents
          transport={transport}
          canEdit={canEdit}
          platform={current}
        />
      ) : null}

      <RuleChangeDialog
        preview={preview}
        onCancel={() => setPreview(null)}
        onConfirm={(earned) => void commit(earned)}
      />
    </div>
  );
}

function SettingRow({
  settingKey: key,
  scopeKind,
  rules,
  draft,
  editing,
  canEdit,
  onOverride,
  onRevert,
  onChange,
}: {
  settingKey: LearningSettingKey;
  scopeKind: LearningScopeKind;
  rules: LearningScopeRules;
  draft: LearningSettingValues;
  editing: boolean;
  canEdit: boolean;
  onOverride: () => void;
  onRevert: () => void;
  onChange: (value: unknown) => void;
}) {
  const label = SETTING_LABEL[key];
  const effective = rules.effective.find((e) => e.key === key);
  const inDraft = Object.hasOwn(draft, key);
  const wasOwn = Object.hasOwn(rules.values, key);
  const value = inDraft ? draft[key] : effective?.value;
  const provenance = inDraft
    ? R.setHere
    : wasOwn
      ? R.willInherit
      : effective
        ? R.inherited(effective.level, effective.preset)
        : "";
  return (
    <li
      data-testid={`setting-${key}`}
      className="flex flex-col gap-3 border-t border-border py-3"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-bold text-foreground">{label}</span>
          <span className="break-words text-sm text-foreground">
            {wasOwn && !inDraft ? "—" : settingValueInWords(key, value)}
          </span>
          <span>
            <Badge variant={inDraft ? "success" : "label"}>{provenance}</Badge>
          </span>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            {!editing ? (
              <Button
                type="button"
                variant="outline"
                aria-label={R.edit(label)}
                onClick={onOverride}
              >
                {R.editShort}
              </Button>
            ) : null}
            {inDraft && scopeKind !== "platform" ? (
              <Button
                type="button"
                variant="link"
                aria-label={R.revert(label)}
                onClick={onRevert}
              >
                {R.revertShort}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {canEdit && editing && inDraft ? (
        <SettingControl settingKey={key} value={value} onChange={onChange} />
      ) : null}
    </li>
  );
}

// ── Presets on the platform scope (EARS-9, EARS-29) ──────────────────────────

function PresetContents({
  transport,
  canEdit,
  platform,
}: {
  transport: LearningAdminTransport;
  canEdit: boolean;
  platform: LearningScopeRules;
}) {
  const [presets, setPresets] = useState<LearningPreset[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setPresets(await transport.presets());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [transport]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section aria-labelledby="presets-heading" className="flex flex-col gap-3">
      <h2 id="presets-heading" className="text-lg font-bold text-foreground">
        {R.presetsHeading}
      </h2>
      <p className="text-sm text-muted-foreground">{R.presetsHint}</p>
      {failed ? <Alert variant="danger">{C.loadFailed}</Alert> : null}
      {(presets ?? []).map((preset) => (
        <PresetCard
          key={preset.id}
          preset={preset}
          canEdit={canEdit}
          platform={platform}
          transport={transport}
          onSaved={load}
        />
      ))}
    </section>
  );
}

function PresetCard({
  preset,
  canEdit,
  platform,
  transport,
  onSaved,
}: {
  preset: LearningPreset;
  canEdit: boolean;
  platform: LearningScopeRules;
  transport: LearningAdminTransport;
  onSaved: () => Promise<void>;
}) {
  const id = useId();
  const [draft, setDraft] = useState<LearningSettingValues | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [refused, setRefused] = useState<string[] | null>(null);
  const entries = Object.entries(preset.values) as [
    LearningSettingKey,
    unknown,
  ][];
  const missing = (Object.keys(SETTING_LABEL) as LearningSettingKey[]).filter(
    (k) => draft && !Object.hasOwn(draft, k),
  );

  async function save() {
    if (!draft) return;
    setBusy(true);
    setRefused(null);
    try {
      await transport.updatePreset(preset.id, draft, preset.version);
      setDraft(null);
      setDone(R.presetSaved(preset.name));
      await onSaved();
    } catch (error) {
      if (isStale(error)) {
        setRefused([R.stale]);
        setDraft(null);
        await onSaved();
      } else {
        const denied = authorityRefusal(error, "platform");
        const lines = rulesRefusalLines(error);
        setRefused(denied ? [denied] : lines.length > 0 ? lines : [C.failed]);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid={`preset-contents-${preset.id}`}>
      <CardHeader>
        <h3 className="text-base font-bold text-foreground">{preset.name}</h3>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
          {done ? <Alert variant="success">{done}</Alert> : null}
          {refused ? (
            <Alert variant="danger" data-testid="preset-refusal">
              <ul className="list-disc pl-5">
                {refused.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </Alert>
          ) : null}
          <ul className="flex flex-col gap-1 text-sm text-foreground">
            {entries.map(([key, value]) => (
              <li key={key}>
                {SETTING_LABEL[key]}: {settingValueInWords(key, value)}
              </li>
            ))}
          </ul>
          {canEdit && !draft ? (
            <div>
              <Button
                variant="outline"
                onClick={() => {
                  setDone(null);
                  setDraft(settingValues(preset.values));
                }}
              >
                {R.editPreset(preset.name)}
              </Button>
            </div>
          ) : null}
          {canEdit && draft ? (
            <div className="flex flex-col gap-4 border-t border-border pt-3">
              {(Object.keys(draft) as LearningSettingKey[]).map((key) => (
                <div key={key} className="flex flex-col gap-2">
                  <SettingControl
                    settingKey={key}
                    value={draft[key]}
                    onChange={(value) =>
                      setDraft((d) => (d ? { ...d, [key]: value } : d))
                    }
                  />
                  <div>
                    <Button
                      type="button"
                      variant="link"
                      onClick={() =>
                        setDraft((d) => {
                          if (!d) return d;
                          const { [key]: _gone, ...rest } = d;
                          return rest;
                        })
                      }
                    >
                      {R.removeFromPreset(SETTING_LABEL[key])}
                    </Button>
                  </div>
                </div>
              ))}
              {missing.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${id}-add`}>{R.addToPreset}</Label>
                  <NativeSelect
                    id={`${id}-add`}
                    value=""
                    onChange={(e) => {
                      const key = e.target.value as LearningSettingKey;
                      const base = platform.effective.find(
                        (x) => x.key === key,
                      );
                      setDraft((d) =>
                        d ? { ...d, [key]: clone(base?.value) } : d,
                      );
                    }}
                  >
                    <option value="">{R.addToPresetNone}</option>
                    {missing.map((k) => (
                      <option key={k} value={k}>
                        {SETTING_LABEL[k]}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-3">
                <Button disabled={busy} onClick={() => void save()}>
                  {R.savePreset}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setDraft(null)}
                >
                  {R.cancel}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
