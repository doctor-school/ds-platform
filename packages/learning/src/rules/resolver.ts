import type { LearningScopeKind } from "@ds/schemas";
import {
  LEARNING_PLATFORM_SCOPE_ID,
  type LearningLayer,
  type LearningScopePath,
  type LearningSettingKey,
  type LearningSettings,
} from "../model.js";

// 024 EARS-5 — the layer resolver: step → lesson → module → course → school →
// platform, the nearest layer HOLDING the key winning, a layer with no row
// skipped. The platform layer holds every key, so resolution always ends.

export interface ResolvedSetting<K extends LearningSettingKey> {
  key: K;
  value: LearningSettings[K];
  level: LearningScopeKind;
  preset: string | null;
}

const WALK: Exclude<LearningScopeKind, "platform">[] = [
  "step",
  "lesson",
  "module",
  "course",
  "school",
];

export class LearningPlatformLayerIncompleteError extends Error {
  constructor(readonly key: string) {
    super(`the platform learning layer holds no value for ${key}`);
  }
}

/** An index of rule layers by scope. */
export class LearningLayers {
  private readonly byScope = new Map<string, LearningLayer>();

  constructor(layers: Iterable<LearningLayer>) {
    for (const layer of layers) {
      this.byScope.set(`${layer.scopeKind}:${layer.scopeId}`, layer);
    }
  }

  layer(kind: LearningScopeKind, id: string): LearningLayer | undefined {
    return this.byScope.get(`${kind}:${id}`);
  }

  /** EARS-5 — value, source level and preset of `key` at `path`. */
  resolve<K extends LearningSettingKey>(
    key: K,
    path: LearningScopePath,
  ): ResolvedSetting<K> {
    for (const level of WALK) {
      const id = path[level];
      if (id === undefined) continue;
      const hit = this.at(level, id, key);
      if (hit) return hit;
    }
    const platform = this.at("platform", LEARNING_PLATFORM_SCOPE_ID, key);
    if (!platform) throw new LearningPlatformLayerIncompleteError(key);
    return platform;
  }

  /** Shorthand for the value only. */
  value<K extends LearningSettingKey>(key: K, path: LearningScopePath): LearningSettings[K] {
    return this.resolve(key, path).value;
  }

  private at<K extends LearningSettingKey>(
    level: LearningScopeKind,
    id: string,
    key: K,
  ): ResolvedSetting<K> | undefined {
    const layer = this.layer(level, id);
    if (!layer || !Object.hasOwn(layer.values, key)) return undefined;
    const value = layer.values[key];
    if (value === undefined) return undefined;
    const fromPreset =
      layer.preset !== null &&
      (layer.presetValues === undefined ||
        (Object.hasOwn(layer.presetValues, key) &&
          JSON.stringify(layer.presetValues[key]) === JSON.stringify(value)));
    return { key, value: value as LearningSettings[K], level, preset: fromPreset ? layer.preset : null };
  }
}

/**
 * EARS-9 — apply a preset on a layer: the preset's map merged over the keys it
 * names; keys it does not name stay, every other layer is untouched (the
 * caller writes this one layer only).
 */
export function applyPresetValues(
  current: LearningLayer["values"],
  preset: LearningLayer["values"],
): LearningLayer["values"] {
  return { ...current, ...structuredClone(preset) };
}
