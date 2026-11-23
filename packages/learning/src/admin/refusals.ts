import type {
  LearningScopeKind,
  LearningSettingKey,
  LearningStepAdmin,
} from "@ds/schemas";

import { FIELD_LABEL, RULES_COPY, SETTING_LABEL } from "./admin-copy";
import { asRefusal } from "./transport";

// 024 EARS-4 / EARS-28 — a refusal in the staff member's words. The server
// names each missing item of a publish (`409 PUBLISH_REQUIREMENTS_NOT_MET`) by
// path: `steps`, `steps.<i>.media`, `steps.<i>.source`, `steps.<i>.<payload
// field>`, `exitTest`, `entryTest`; every other refusal names its field errors.

/** The items of a refused publish, or null for any other refusal. */
export function publishRefusalItems(
  error: unknown,
  steps: readonly LearningStepAdmin[],
): string[] | null {
  const r = asRefusal(error);
  if (r.errorCode !== "PUBLISH_REQUIREMENTS_NOT_MET") return null;
  return (r.fieldErrors ?? []).map(({ path, message }) => {
    if (path === "steps") return "В уроке нет ни одного шага.";
    if (path === "exitTest")
      return "Правила курса требуют итоговый тест — добавьте шаг «Тест».";
    if (path === "entryTest") return "Правила курса требуют входной тест.";
    const m = /^steps\.(\d+)\.(.+)$/.exec(path);
    if (m) {
      const i = Number(m[1]);
      const head = `Шаг ${i + 1}${steps[i] ? ` «${steps[i]!.title}»` : ""}`;
      if (m[2] === "media") return `${head}: загрузите файл.`;
      if (m[2] === "source")
        return `${head}: укажите площадку и ссылку на видео.`;
      return `${head}: проверьте содержимое шага (${message}).`;
    }
    return message;
  });
}

/** The field errors of a refused write, each as «Поле: сообщение». */
export function refusedFieldLines(error: unknown): string[] {
  const r = asRefusal(error);
  return (r.fieldErrors ?? []).map(({ path, message }) => {
    const field = path.split(".")[0] ?? path;
    return `${FIELD_LABEL[field] ?? path}: ${message}`;
  });
}

/** A step write refused because the lesson is published (EARS-4). */
export function isPublishedRefusal(error: unknown): boolean {
  return asRefusal(error).errorCode === "INVALID_TRANSITION";
}

export function isStale(error: unknown): boolean {
  const r = asRefusal(error);
  return r.statusCode === 412 || r.errorCode === "PRECONDITION_FAILED";
}

/**
 * EARS-29 — a refused rules write in the staff member's words: the validator
 * names `values.<setting key>[.<node path>]`, and setting keys hold dots
 * themselves, so the longest key the path starts with names the setting.
 */
export function rulesRefusalLines(error: unknown): string[] {
  const keys = (Object.keys(SETTING_LABEL) as LearningSettingKey[]).sort(
    (a, b) => b.length - a.length,
  );
  return (asRefusal(error).fieldErrors ?? []).map(({ path, message }) => {
    const rest = path.startsWith("values.") ? path.slice(7) : path;
    const key = keys.find((k) => rest === k || rest.startsWith(`${k}.`));
    if (key) return `${SETTING_LABEL[key]}: ${message}`;
    return `${FIELD_LABEL[rest.split(".")[0] ?? rest] ?? path}: ${message}`;
  });
}

/**
 * EARS-30 — a write refused for the scope's authority (403), as the one-line
 * reason the editor shows read-only; null for any other refusal.
 */
export function authorityRefusal(
  error: unknown,
  scopeKind: LearningScopeKind,
): string | null {
  const code = asRefusal(error).errorCode;
  if (code === "LEARNING_RULES_EDITOR_REQUIRED")
    return scopeKind === "platform"
      ? RULES_COPY.readOnly.platform
      : RULES_COPY.readOnly.published;
  if (code === "PLATFORM_ADMIN_REQUIRED") return RULES_COPY.readOnly.draft;
  return null;
}
