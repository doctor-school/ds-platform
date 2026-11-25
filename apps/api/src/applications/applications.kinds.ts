import type { z } from "zod";
import {
  type ApplicationKind,
  AUTHOR_APPLICATION_CONSENT_DOCUMENT_SLUG,
  AUTHOR_APPLICATION_PERSONAL_DATA_PURPOSE,
  type AuthorApplicationPayload,
  AuthorApplicationPayloadSchema,
} from "@ds/schemas";

/**
 * 033-design «Request kinds (the 034 seam)» — one entry per closed
 * `ApplicationKind`. A new kind (the interim partnership form #4034, 034's
 * investor) extends the enum in `@ds/schemas`, adds its entry here and widens
 * `applications_kind_check`; the queue's storage, retention, erasure and audit
 * work unchanged, and the notifications slice (#4029) resolves the receipt
 * recipient from `receiptTo`.
 */
export interface ApplicationKindDefinition<P = unknown> {
  /** The stored payload's schema (the erasure tombstone aside). */
  payloadSchema: z.ZodType<P>;
  /** The no-account kinds' contact schema; `null` for an account kind. */
  contactSchema: z.ZodType | null;
  /** The admin list's subject line (topic, or company / name). */
  subjectLine: (payload: P, contact: unknown) => string;
  /** `me`: a signed-in intake under `/v1/me`; `public`: a guest intake. */
  intake: "me" | "public";
  consentPurpose: string;
  /** The `@ds/legal-content` document the consent version is stamped from. */
  consentDocumentSlug: string;
  /** Who gets «Заявка получена» (EARS-12); `null` = `not_applicable`. */
  receiptTo: "account-email" | "contact-email" | null;
  /** The admin label of the kind (EARS-13). */
  label: string;
}

export const APPLICATION_KIND_TABLE = {
  author: {
    payloadSchema: AuthorApplicationPayloadSchema,
    contactSchema: null,
    subjectLine: (payload) => payload.topic,
    intake: "me",
    consentPurpose: AUTHOR_APPLICATION_PERSONAL_DATA_PURPOSE,
    consentDocumentSlug: AUTHOR_APPLICATION_CONSENT_DOCUMENT_SLUG,
    receiptTo: "account-email",
    label: "Автор",
  } satisfies ApplicationKindDefinition<AuthorApplicationPayload>,
} satisfies Record<ApplicationKind, object>;
