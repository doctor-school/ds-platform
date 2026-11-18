// `@ds/learning/admin` — the staff screens of 024 (design §1): lesson
// composition (EARS-28) and the course's preset choice (EARS-29 slice 1).
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
