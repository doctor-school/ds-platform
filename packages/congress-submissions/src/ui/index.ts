/**
 * The section UI entry: the whole «Мои заявки на Конгресс» section a host
 * mounts at its route, plus the autosave hook it is built on.
 */
export { CongressSection, type CongressSectionHost } from "./congress-section";
export { useAutosave, type Autosave, type SaveState } from "./use-autosave";
