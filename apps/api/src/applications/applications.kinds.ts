import type { z } from "zod";
import {
  type ApplicationKind,
  AUTHOR_APPLICATION_CONSENT_DOCUMENT_SLUG,
  AUTHOR_APPLICATION_PERSONAL_DATA_PURPOSE,
  type AuthorApplicationPayload,
  AuthorApplicationPayloadSchema,
  INVESTOR_REQUEST_CONSENT_PURPOSE,
  INVESTOR_REQUEST_CONSENT_VERSION_TAG,
  type InvestorRequestContact,
  InvestorRequestContactSchema,
  type InvestorRequestPayload,
  InvestorRequestPayloadSchema,
  PARTNERSHIP_CONSENT_PURPOSE,
  PARTNERSHIP_CONSENT_VERSION_TAG,
  type PartnershipRequestContact,
  PartnershipRequestContactSchema,
  type PartnershipRequestPayload,
  PartnershipRequestPayloadSchema,
} from "@ds/schemas";

/**
 * 033-design «Request kinds (the 034 seam)» — one entry per closed
 * `ApplicationKind`. A new kind (034's investor) extends the enum in
 * `@ds/schemas`, adds its entry here and widens `applications_kind_check`;
 * the queue's storage, retention, erasure and audit work unchanged, and the notifications slice (#4029) resolves the receipt
 * recipient from `receiptTo`.
 */
export interface ApplicationKindDefinition<P = unknown, C = unknown> {
  /** The stored payload's schema (the erasure tombstone aside). */
  payloadSchema: z.ZodType<P>;
  /** The no-account kinds' contact schema; `null` for an account kind. */
  contactSchema: z.ZodType | null;
  /** The admin list's subject line (topic, or company / name). */
  subjectLine: (payload: P, contact: C) => string;
  /** `me`: a signed-in intake under `/v1/me`; `public`: a guest intake. */
  intake: "me" | "public";
  consentPurpose: string;
  /**
   * The `@ds/legal-content` document the consent version is stamped from, or
   * `null` for a kind whose consent is a fixed tick with a fixed version tag
   * ({@link consentVersionTag}).
   */
  consentDocumentSlug: string | null;
  /** The fixed consent version tag of a kind with no consent document. */
  consentVersionTag: string | null;
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
    consentVersionTag: null,
    receiptTo: "account-email",
    label: "Автор",
  } satisfies ApplicationKindDefinition<AuthorApplicationPayload>,
  partnership: {
    payloadSchema: PartnershipRequestPayloadSchema,
    contactSchema: PartnershipRequestContactSchema,
    subjectLine: (payload) => payload.companyOrClinic ?? payload.name,
    intake: "public",
    consentPurpose: PARTNERSHIP_CONSENT_PURPOSE,
    consentDocumentSlug: null,
    consentVersionTag: PARTNERSHIP_CONSENT_VERSION_TAG,
    // The home form promises no letter (033-design «Lead decisions» 20).
    receiptTo: null,
    label: "Партнёрство",
  } satisfies ApplicationKindDefinition<
    PartnershipRequestPayload,
    PartnershipRequestContact
  >,
  investor: {
    payloadSchema: InvestorRequestPayloadSchema,
    contactSchema: InvestorRequestContactSchema,
    subjectLine: (_payload, contact) => contact.organisation,
    intake: "public",
    consentPurpose: INVESTOR_REQUEST_CONSENT_PURPOSE,
    consentDocumentSlug: null,
    consentVersionTag: INVESTOR_REQUEST_CONSENT_VERSION_TAG,
    // 034 EARS-9: «Заявка получена» to the request's work email.
    receiptTo: "contact-email",
    label: "Инвестор",
  } satisfies ApplicationKindDefinition<
    InvestorRequestPayload,
    InvestorRequestContact
  >,
} satisfies Record<ApplicationKind, object>;
