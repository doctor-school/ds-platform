import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * 003 EARS-64 / ADR-0015 §4 — the sign-in host's one shared browser session per
 * browser: at most one row per `__Host-ds_login` cookie, holding one Zitadel
 * session.
 *
 * - `cookie_id_hash` — SHA-256 (hex) of the cookie value (≥128 random bits).
 *   The cookie value itself is never stored, so a dump of this table opens no
 *   browser's record. Rotated with every credential step (req. 5 fixation).
 * - `zitadel_session_id` / `session_token` — at-rest envelopes
 *   (`apps/api/src/common/crypto/at-rest.ts`, AES-256-GCM under
 *   `SIGN_IN_RECORD_KEY`), each bound to `cookie_id_hash` as additional data so
 *   an envelope moved to another row does not open.
 * - `subject` — the Zitadel user id the session checked (the own-account
 *   hand-off peek, design «Hand-off on the sign-in host»).
 * - `fingerprint` — SHA-256 of UA + IP /24 + accept-language
 *   (`computeFingerprint`), checked on every use.
 * - `last_credential_at` — the credential step (`max_age`, EARS-68).
 * - `last_finalised_at` — the 7-day idle timeout.
 * - `expires_at` — `last_credential_at` + 30 days, the explicit Zitadel session
 *   lifetime; never extended.
 *
 * Retention (decided with the table): a row is ephemeral session state, not a
 * retained record. It is deleted on replacement, on fingerprint mismatch, on
 * sign-out (#3006 S6) and by the hourly purge in
 * `apps/api/src/sign-in-host/sign-in-host-record.purge.ts` once `expires_at`
 * or the 7-day idle has passed; nothing outlives 30 days from its credential
 * step. The two indexes serve that purge.
 */
export const signInHostRecords = pgTable(
  "sign_in_host_records",
  {
    cookieIdHash: text("cookie_id_hash").primaryKey(),
    subject: text("subject").notNull(),
    zitadelSessionId: text("zitadel_session_id").notNull(),
    sessionToken: text("session_token").notNull(),
    fingerprint: text("fingerprint").notNull(),
    lastCredentialAt: timestamp("last_credential_at", {
      withTimezone: true,
    }).notNull(),
    lastFinalisedAt: timestamp("last_finalised_at", {
      withTimezone: true,
    }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("sign_in_host_records_expires_at_idx").on(table.expiresAt),
    index("sign_in_host_records_last_finalised_at_idx").on(
      table.lastFinalisedAt,
    ),
  ],
);

export type SignInHostRecordRow = typeof signInHostRecords.$inferSelect;
