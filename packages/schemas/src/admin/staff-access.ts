import { z } from "zod";

/**
 * 047 — staff access («Доступы»): the contract the API and the admin form share
 * (047-design §Work-package map → Contract).
 *
 * `GRANTABLE_STAFF_ROLES` is the ONE list of roles a platform administrator may
 * grant from the section. The API validates against it and the admin form draws
 * its role select from it, so a future grantable role is one edit here.
 * `pd_officer` is deliberately absent (047-design §«`pd_officer` not grantable
 * yet»).
 */
export const GRANTABLE_STAFF_ROLES = [
  "platform_admin",
  "event-registrar",
  "congress-program-committee",
] as const;
export type GrantableStaffRole = (typeof GRANTABLE_STAFF_ROLES)[number];

/**
 * The grantable roles bound to one event (`event_role_grants`): a grant of one
 * of these names its event, a grant of any other role names none (047 EARS-3).
 */
export const EVENT_BOUND_STAFF_ROLES = [
  "event-registrar",
  "congress-program-committee",
] as const satisfies readonly GrantableStaffRole[];
export type EventBoundStaffRole = (typeof EVENT_BOUND_STAFF_ROLES)[number];

export function isEventBoundStaffRole(
  role: string,
): role is EventBoundStaffRole {
  return (EVENT_BOUND_STAFF_ROLES as readonly string[]).includes(role);
}

/**
 * One row of the «Доступы» list (047 EARS-2): one per person and role, and per
 * event for an event-bound role. `userId` is the person's IdP subject — the
 * identity the IdP grant and the revocation command are keyed by. `eventId` is
 * `null` for `platform_admin`, and for an event-bound role whose binding row is
 * missing (a half-finished grant or revocation, listed so it stays visible and
 * revocable — 047-design §The list).
 */
export const StaffAccessRowSchema = z.strictObject({
  userId: z.string().min(1),
  fullName: z.string().nullable(),
  email: z.string().nullable(),
  role: z.enum(GRANTABLE_STAFF_ROLES),
  eventId: z.uuid().nullable(),
  eventTitle: z.string().nullable(),
});
export type StaffAccessRow = z.infer<typeof StaffAccessRowSchema>;

/** `GET /v1/admin/staff-access` — every holder of a grantable role (EARS-2). */
export const StaffAccessListResponseSchema = z.strictObject({
  items: z.array(StaffAccessRowSchema),
});
export type StaffAccessListResponse = z.infer<
  typeof StaffAccessListResponseSchema
>;

/**
 * ФИО is one field (047-design §Grant cascade → New account): at least two
 * words — the first is the family name, the rest the given name and patronymic.
 * Inner whitespace is collapsed so the split and the stored display name agree.
 */
const FullNameSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s+/g, " "))
  .pipe(
    z
      .string()
      .min(1)
      .max(200)
      .refine((value) => value.split(" ").length >= 2, {
        message: "full name must contain at least two words",
      }),
  );

/**
 * `POST /v1/admin/staff-access/grants` (047 EARS-3). The event is required
 * exactly for the event-bound roles and refused for any other role — a shape
 * rule, so it is a `400` from the validation pipe before any read or write.
 */
export const StaffAccessGrantRequestSchema = z
  .strictObject({
    email: z.string().trim().toLowerCase().pipe(z.email()),
    fullName: FullNameSchema,
    role: z.enum(GRANTABLE_STAFF_ROLES),
    eventId: z.uuid().optional(),
  })
  .superRefine((value, ctx) => {
    const bound = isEventBoundStaffRole(value.role);
    if (bound && value.eventId === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["eventId"],
        message: "an event is required for this role",
      });
    }
    if (!bound && value.eventId !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["eventId"],
        message: "this role takes no event",
      });
    }
  });
export type StaffAccessGrantRequest = z.infer<
  typeof StaffAccessGrantRequestSchema
>;

/**
 * `201` answer of a grant (047 EARS-6). `temporaryPassword` is present only when
 * THIS request set the account's password (a new account, or an existing one
 * without a password); it is shown once and exists nowhere else.
 */
export const StaffAccessGrantResponseSchema = z.strictObject({
  row: StaffAccessRowSchema,
  temporaryPassword: z.string().optional(),
});
export type StaffAccessGrantResponse = z.infer<
  typeof StaffAccessGrantResponseSchema
>;

/**
 * `POST /v1/admin/staff-access/revocations` (047 EARS-7) — the row identity:
 * person, role and, for an event-bound role, the event.
 */
export const StaffAccessRevokeRequestSchema = z.strictObject({
  userId: z.string().min(1),
  role: z.enum(GRANTABLE_STAFF_ROLES),
  eventId: z.uuid().optional(),
});
export type StaffAccessRevokeRequest = z.infer<
  typeof StaffAccessRevokeRequestSchema
>;

/**
 * `POST /v1/admin/auth/mfa/reverify` (047 EARS-8) — the step-up re-verification
 * of the CURRENT admin session. `endpoint` names the refused request the console
 * will send again, as `"<METHOD> <route>"` (e.g.
 * `"POST /v1/admin/staff-access/grants"`); the API accepts only a route that
 * declares `stepUp` and records it on the `auth.step_up.*` row.
 */
export const AdminMfaReverifyRequestSchema = z.strictObject({
  code: z.string().regex(/^\d{6}$/),
  endpoint: z.string().min(1).max(200),
});
export type AdminMfaReverifyRequest = z.infer<
  typeof AdminMfaReverifyRequestSchema
>;

/** Answer of an accepted re-verification: the session is fresh again. */
export const AdminMfaReverifyResponseSchema = z.strictObject({
  state: z.literal("active"),
});
export type AdminMfaReverifyResponse = z.infer<
  typeof AdminMfaReverifyResponseSchema
>;
