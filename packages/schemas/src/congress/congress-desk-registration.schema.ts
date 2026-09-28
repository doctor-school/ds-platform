import { z } from "zod";
import { CongressSignUpRequestSchema } from "./congress-signup.schema.js";

/**
 * 044 EARS-35 — the registrar's manual («стол») registration of a walk-in
 * participant, `POST /v1/admin/events/:idOrSlug/registrations`.
 *
 * COMPOSED from the public intake request rather than copied, because EARS-35
 * says the desk entry IS the intake: the same answer fields with the same
 * normalisation and the same contact-phone refusal. Two keys differ, and each
 * is a decision:
 *
 *  - `personalDataConsent` is replaced by `paperConsent`: the participant did
 *    not tick a box on a screen, the registrar attests that the signed paper
 *    form is in hand. `z.literal(true)` for the reason the online acceptance is
 *    one — without it this is not a desk registration at all, and the pipe
 *    refuses it before any side effect. The VERSION is still server-stamped
 *    (EARS-9); the row is marked `origin = 'paper'`.
 *  - `captchaToken` is absent: the desk route is an authenticated admin route
 *    and carries no bot protection (EARS-35 «без капчи»).
 */
export const CongressDeskRegistrationRequestSchema =
  CongressSignUpRequestSchema.omit({
    personalDataConsent: true,
    captchaToken: true,
  }).extend({
    paperConsent: z.literal(true),
  });
export type CongressDeskRegistrationRequest = z.infer<
  typeof CongressDeskRegistrationRequestSchema
>;

/**
 * 044 EARS-35 — the desk's answer. Unlike the public intake (EARS-7), it NAMES
 * the registration so the registrar can open its card: `accepted` for a new
 * one, `existing` when this participant was already registered for the event
 * (EARS-8 — nothing new was written). It deliberately carries nothing that says
 * whether the Doctor.School ACCOUNT existed before this entry
 * (`account_created_by_intake`): that is not the registrar's to learn.
 */
export const CongressDeskRegistrationResponseSchema = z.strictObject({
  status: z.enum(["accepted", "existing"]),
  registrationId: z.uuid(),
});
export type CongressDeskRegistrationResponse = z.infer<
  typeof CongressDeskRegistrationResponseSchema
>;
