import type { LearningSettings, LearningSettingValues } from "@ds/schemas";

// 024 EARS-5, EARS-8, EARS-9 — the ONLY defaults in code: the platform layer's
// seed and the three presets' contents (024-design §3). Migration
// `0062_learning_path.sql` inserts exactly these as rows, and the runtime reads
// the rows, never these constants (an api e2e pins rows = constants).

/** The platform layer: a value for every setting (EARS-5). */
export const LEARNING_PLATFORM_SEED: LearningSettings = {
  "completion.step": { condition: "viewed" },
  "completion.lesson": {
    all: [
      { condition: "all-steps-done" },
      { condition: "test-passed", test: "exit" },
    ],
  },
  "completion.module": {
    all: [{ condition: "lessons-done" }, { condition: "club-attended" }],
  },
  "completion.course": { condition: "lessons-done" },
  "viewed.video.percent": 100,
  "viewed.podcast.percent": 90,
  unlock: { kind: "after-previous" },
  order: "strict",
  lockedVisibility: "locked",
  "test.threshold": 80,
  "test.attempts": "unlimited",
  "test.pauseMin": 0,
  "test.questions": "all",
  "test.exitRequired": true,
  "test.entryRequired": false,
  "test.entryCounts": false,
  "testOut.allowed": false,
  "testOut.pauseMin": 0,
  "repeat.allowed": true,
  "course.deliveryMode": "online",
  "course.moduleSize": 6,
  "course.closingClub": true,
  "course.clubInCompletion": false,
};

export const LEARNING_PRESET_NAMES = {
  path: "Путь (Duolingo)",
  open: "Открытый курс",
  accredited: "ДПО / аккредитация",
} as const;

/** EARS-9 — the three presets, each with the exit test required (owner D9). */
export const LEARNING_PRESET_SEEDS: ReadonlyArray<{
  name: string;
  values: LearningSettingValues;
}> = [
  {
    name: LEARNING_PRESET_NAMES.path,
    values: {
      order: "strict",
      unlock: { kind: "after-previous" },
      "testOut.allowed": true,
      "repeat.allowed": true,
      lockedVisibility: "locked",
      "test.exitRequired": true,
    },
  },
  {
    name: LEARNING_PRESET_NAMES.open,
    values: {
      unlock: { kind: "immediate" },
      order: "free",
      "completion.lesson": {
        all: [
          { condition: "all-steps-done" },
          { condition: "test-passed", test: "exit" },
        ],
      },
      "test.exitRequired": true,
    },
  },
  {
    name: LEARNING_PRESET_NAMES.accredited,
    values: {
      "completion.lesson": {
        all: [
          { condition: "all-steps-done" },
          { condition: "test-passed", test: "exit" },
        ],
      },
      "test.threshold": 80,
      "test.entryRequired": true,
      order: "strict",
      "testOut.allowed": false,
      "test.exitRequired": true,
    },
  },
];
