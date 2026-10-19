import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { captchaTestTokenFromEnv } from "./captcha-stub.js";
import {
  assertNoAddressedMail,
  captureAddressedMailCheckpoint,
  mailpitUrlFor,
  nativeRecoveryMail,
  type AddressedMailCheckpoint,
} from "./mailpit.js";

export interface OwnedCongressSignup {
  email: string;
  reference: string;
  notice: AddressedMailCheckpoint;
}

/** 044 EARS-1/39: mint references only through the real configured congress intake. */
export async function createOwnedCongressSignup(
  page: Page,
  hostBaseUrl: string,
  addressPrefix: string,
  options: { contactPhone?: string } = {},
): Promise<OwnedCongressSignup> {
  const email = `${addressPrefix}-${randomUUID()}@example.test`;
  await page.goto(hostBaseUrl, { waitUntil: "load" });
  const before = await captureAddressedMailCheckpoint(
    nativeRecoveryMail(),
    process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(hostBaseUrl),
    email,
  );
  expect(before.messageIds.length, "fresh page mailbox is empty").toBe(0);
  // 044 EARS-1/39: use the real intake as the only reference minter.
  const accepted = await page.evaluate(
    async ({ email, captchaToken, contactPhone }) => {
      const book = await fetch("/v1/public/specialties");
      const specialties = await book.json().catch(() => ({}));
      const specialtyId = specialties.entries?.[0]?.id;
      if (!book.ok || typeof specialtyId !== "string")
        throw new Error("Congress specialty prerequisite is unavailable");
      const response = await fetch("/v1/congress/sign-up", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(captchaToken ? { "x-smartcaptcha-token": captchaToken } : {}),
        },
        body: JSON.stringify({
          surname: "Иванова",
          firstName: "Мария",
          patronymic: "Петровна",
          email,
          specialtyId,
          workplace: "ГКБ № 1",
          city: "Москва",
          region: "Москва",
          contactPhone,
          personalDataConsent: true,
        }),
      });
      const body = await response.json().catch(() => ({}));
      return {
        status: response.status,
        accepted: body.status === "accepted",
        reference:
          typeof body.handoff === "string" &&
          /^[A-Za-z0-9_-]{43}$/.test(body.handoff)
            ? body.handoff
            : undefined,
      };
    },
    {
      email: email,
      contactPhone: options.contactPhone ?? "+7 (900) 123-45-67",
      captchaToken:
        process.env.BOT_PROTECTION_ENABLED === "false"
          ? undefined
          : captchaTestTokenFromEnv(),
    },
  );
  expect(
    {
      status: accepted.status,
      accepted: accepted.accepted,
      validReference: Boolean(accepted.reference),
    },
    "real congress intake accepted the page account and minted a reference",
  ).toEqual({ status: 200, accepted: true, validReference: true });
  const mail = nativeRecoveryMail();
  const mailpit = process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(hostBaseUrl);
  // 044 EARS-11/13: the real intake sends its own code-free notice first.
  await expect
    .poll(
      async () =>
        (await captureAddressedMailCheckpoint(mail, mailpit, email)).messageIds
          .length,
      { message: "the congress confirmation notice is delivered" },
    )
    .toBe(1);
  const notice = await captureAddressedMailCheckpoint(mail, mailpit, email);
  const detail = await mail.get(
    `${mailpit.replace(/\/$/, "")}/api/v1/message/${encodeURIComponent(notice.messageIds[0]!)}`,
  );
  expect(detail.status(), "page congress notice can be read").toBe(200);
  const message = (await detail.json().catch(() => {
    throw new Error("Malformed page congress notice");
  })) as { ID?: string; Subject?: string; To?: { Address?: string }[] };
  expect(
    message.ID === notice.messageIds[0] &&
      message.To?.some(
        (recipient) => recipient.Address?.toLowerCase() === email,
      ) &&
      typeof message.Subject === "string" &&
      message.Subject.startsWith("Doctor.School — вы зарегистрированы на ") &&
      message.Subject.length > "Doctor.School — вы зарегистрированы на ".length,
    "the pre-handoff delivery is the real congress notice, not an auth-code mail",
  ).toBe(true);
  await assertNoAddressedMail(mail, mailpit, email, notice);
  return { email, reference: accepted.reference!, notice };
}
