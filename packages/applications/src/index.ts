/**
 * The application-queue unit's MODEL entry (033): the RU copy of «Подать
 * заявку» and its pure decisions — the form checks, the field errors of a
 * refusal, the submission lifecycle with its idempotency key and the repeat
 * banner. The browser transport is `./client`.
 */
export * from "./copy";
export * from "./model/form";
export * from "./model/submission";
