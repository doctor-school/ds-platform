import { Logger } from "@nestjs/common";
import { Counter, register } from "prom-client";

/**
 * 003 EARS-56: the counter of SMS sign-in and SMS reset requests whose phone
 * identifier is not a confirmed account phone. It is the observable trigger of
 * the deferred cabinet plate «Подтвердите телефон…» (003 requirements, Prior
 * decisions). Labelled by flow only — never by phone, account or IP.
 * Registered in the prom-client DEFAULT registry, like the mailer relay
 * counter (`bff_mailer_relay_events_total`).
 */
export const SMS_UNCONFIRMED_PHONE_METRIC =
  "auth_sms_unconfirmed_phone_requests_total";

export type SmsUnconfirmedFlow = "signin" | "reset";

/** Get-or-create in the default registry — idempotent across `register.clear()`. */
function unconfirmedCounter(): Counter<"flow"> {
  const existing = register.getSingleMetric(SMS_UNCONFIRMED_PHONE_METRIC);
  if (existing) return existing as Counter<"flow">;
  return new Counter<"flow">({
    name: SMS_UNCONFIRMED_PHONE_METRIC,
    help: "SMS sign-in and SMS reset requests for a phone that is not a confirmed account phone (003 EARS-56).",
    labelNames: ["flow"],
  });
}

/**
 * ADR-0001 §5.5 log masking of a phone: the leading country digit and the
 * last four digits survive, the rest is `***` (`+79991234567` → `+7***4567`).
 * A number too short to keep four trailing digits keeps none.
 */
export function maskPhoneForLog(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return "+***";
  return `+${digits.slice(0, 1)}***${digits.slice(-4)}`;
}

/**
 * 003 EARS-56: one increment and one structured, masked log line per request
 * that reached the point where the identifier was found not to be a confirmed
 * account phone. It writes no `audit_ledger` row (a ledger row would mean a
 * code was issued, EARS-18) and changes no response.
 */
export class SmsUnconfirmedCounter {
  private readonly logger = new Logger("SmsUnconfirmedPhone");

  record(flow: SmsUnconfirmedFlow, phone: string): void {
    unconfirmedCounter().inc({ flow });
    this.logger.log(
      JSON.stringify({
        event: "auth.sms.unconfirmed_phone",
        flow,
        phone: maskPhoneForLog(phone),
      }),
    );
  }
}
