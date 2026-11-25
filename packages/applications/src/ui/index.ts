/**
 * The application-queue unit's UI entry (033): «Подать заявку» — the page
 * composition, the account gate, the author form with its states and the
 * repeat banner. The server mount is `./route`.
 */
export { ApplyPage, type ApplyPageProps } from "./apply-page";
export { AccountGate, type AccountGateHost } from "./account-gate";
export {
  AuthorApplication,
  type ApplyViewer,
  type AuthorApplicationHost,
} from "./author-application";
export { type AuthorSpecialty } from "./author-form";
