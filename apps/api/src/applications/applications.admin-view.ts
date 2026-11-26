import type {
  AdminApplicationField,
  ApplicationKind,
  AuthorApplicationPayload,
  InvestorRequestContact,
  InvestorRequestPayload,
  PartnershipRequestContact,
  PartnershipRequestPayload,
} from "@ds/schemas";

/**
 * 033 EARS-14 — how the admin detail shows what an applicant sent: each
 * field with its label, in the form's order, values in their RU form. One
 * entry per closed `ApplicationKind` (`satisfies` below), so a new kind —
 * 034's investor — cannot reach the admin without saying how it reads.
 */
export interface ApplicationAdminView {
  /** The payload's fields; `specialtyName` is the resolved Минздрав name. */
  fields: (
    payload: never,
    resolved: { specialtyName: string | null },
  ) => AdminApplicationField[];
  /** The no-account kinds' contact as sent; `[]` for an account kind. */
  contactFields: (contact: never) => AdminApplicationField[];
  /** The list's applicant column for a no-account kind (EARS-13). */
  contactName: (contact: never) => string | null;
}

const AUTHOR_FORMAT_LABEL: Record<AuthorApplicationPayload["format"], string> =
  {
    course_series: "Курс-сериал",
    single_lesson: "Отдельный урок",
    podcast: "Подкаст",
    talk: "Выступление",
  };

function authorFields(
  payload: AuthorApplicationPayload,
  resolved: { specialtyName: string | null },
): AdminApplicationField[] {
  const out: AdminApplicationField[] = [
    { key: "topic", label: "Тема", value: payload.topic },
    {
      key: "format",
      label: "Формат",
      value: AUTHOR_FORMAT_LABEL[payload.format] ?? payload.format,
    },
  ];
  if (payload.specialtyCode !== undefined)
    out.push({
      key: "specialty",
      label: "Специальность",
      value: resolved.specialtyName ?? payload.specialtyCode,
    });
  else if (payload.specialtyOther !== undefined)
    out.push({
      key: "specialty",
      label: "Специальность",
      value: `Другое: ${payload.specialtyOther}`,
    });
  if (payload.about !== undefined && payload.about.length > 0)
    out.push({ key: "about", label: "О себе", value: payload.about });
  return out;
}

/** The Academy home partnership form's fields, with the form's labels. */
function partnershipFields(
  payload: PartnershipRequestPayload,
): AdminApplicationField[] {
  const out: AdminApplicationField[] = [
    { key: "name", label: "Имя", value: payload.name },
  ];
  if (payload.companyOrClinic !== undefined)
    out.push({
      key: "companyOrClinic",
      label: "Компания или клиника",
      value: payload.companyOrClinic,
    });
  out.push({ key: "role", label: "Роль", value: payload.role });
  return out;
}

function partnershipContactFields(
  contact: PartnershipRequestContact,
): AdminApplicationField[] {
  return [
    {
      key: "emailOrTelegram",
      label: "Email или Telegram",
      value: contact.emailOrTelegram,
    },
  ];
}

/** 034 EARS-10 — the «Инвесторам» form's task, with the form's label. */
function investorFields(
  payload: InvestorRequestPayload,
): AdminApplicationField[] {
  return payload.task === undefined
    ? []
    : [{ key: "task", label: "Задача", value: payload.task }];
}

/** 034 EARS-10 — the investor contact as sent, optional fields only when sent. */
function investorContactFields(
  contact: InvestorRequestContact,
): AdminApplicationField[] {
  const out: AdminApplicationField[] = [
    { key: "organisation", label: "Организация", value: contact.organisation },
    { key: "fullName", label: "ФИО", value: contact.fullName },
  ];
  if (contact.role !== undefined)
    out.push({ key: "role", label: "Роль в организации", value: contact.role });
  out.push({ key: "email", label: "Рабочая почта", value: contact.email });
  if (contact.phone !== undefined)
    out.push({ key: "phone", label: "Телефон", value: contact.phone });
  return out;
}

export const APPLICATION_ADMIN_VIEWS = {
  author: {
    fields: authorFields as ApplicationAdminView["fields"],
    contactFields: () => [],
    contactName: () => null,
  },
  partnership: {
    fields: partnershipFields as ApplicationAdminView["fields"],
    contactFields:
      partnershipContactFields as ApplicationAdminView["contactFields"],
    contactName: ((contact: PartnershipRequestContact) =>
      contact.emailOrTelegram) as ApplicationAdminView["contactName"],
  },
  investor: {
    fields: investorFields as ApplicationAdminView["fields"],
    contactFields:
      investorContactFields as ApplicationAdminView["contactFields"],
    contactName: ((contact: InvestorRequestContact) =>
      contact.fullName) as ApplicationAdminView["contactName"],
  },
} satisfies Record<ApplicationKind, ApplicationAdminView>;

export function adminViewOf(kind: string): ApplicationAdminView | undefined {
  return (APPLICATION_ADMIN_VIEWS as Record<string, ApplicationAdminView>)[
    kind
  ];
}
