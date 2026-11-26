// `@ds/learning/admin` — the staff screens of 024 (design §1): lesson
// composition (EARS-28) and the course's preset choice (EARS-29 slice 1);
// 023 (#4018) — the school editor and the course structure editor.
export type { LearningAdminTransport, LearningAdminRefusal } from "./transport";
export {
  LessonCompositionScreen,
  type LessonCompositionScreenProps,
} from "./lesson-composition";
export {
  CourseCompositionScreen,
  type CourseCompositionScreenProps,
} from "./course-composition";
export { PresetPanel } from "./preset-panel";
export { SETTING_LABEL, settingValueInWords, ruleInWords } from "./admin-copy";
export {
  RulesEditorScreen,
  type RulesEditorScreenProps,
} from "./rules-editor";
export {
  SchoolEditorScreen,
  type SchoolEditorScreenProps,
} from "./school-editor";
export { STRUCTURE_COPY, FIELD_LABEL } from "./admin-copy";
export { structureRefusalLines } from "./refusals";
