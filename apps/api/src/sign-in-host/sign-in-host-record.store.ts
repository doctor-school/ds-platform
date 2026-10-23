import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { eq, lt, or } from "drizzle-orm";
import { signInHostRecords, type DrizzleHandle } from "@ds/db";
import type { IdpSession } from "../auth/idp/idp.types.js";
import { openAtRest, sealAtRest } from "../common/crypto/at-rest.js";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { SIGN_IN_HOST_IDLE_SECONDS } from "./sign-in-host.policy.js";
import { SIGN_IN_HOST_RECORD_KEY } from "./sign-in-host.tokens.js";

type Db = DrizzleHandle["db"];

/** A decrypted record, as the sign-in host works with it. */
export interface SignInHostRecord {
  readonly session: IdpSession;
  readonly fingerprint: string;
  readonly lastCredentialAt: Date;
  readonly lastFinalisedAt: Date;
  readonly expiresAt: Date;
}

/** `SHA-256(cookie id)` — the only form of the cookie value the table holds. */
export function cookieIdHash(cookieId: string): string {
  return createHash("sha256").update(cookieId).digest("hex");
}

/**
 * 003 EARS-64 — the `sign_in_host_records` store. The Zitadel session id and
 * token are sealed under `SIGN_IN_RECORD_KEY` with the row's own key as bound
 * context; a row whose envelopes no longer open (key rotated away, row edited)
 * reads as no record. Deletes here are physical by design: the row is
 * ephemeral session state (see the schema file's retention note), not a
 * retained record.
 */
@Injectable()
export class SignInHostRecordStore {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    @Inject(SIGN_IN_HOST_RECORD_KEY) private readonly key: Buffer,
  ) {}

  async find(cookieId: string): Promise<SignInHostRecord | null> {
    const hash = cookieIdHash(cookieId);
    const [row] = await this.db
      .select()
      .from(signInHostRecords)
      .where(eq(signInHostRecords.cookieIdHash, hash))
      .limit(1);
    if (!row) return null;
    const zitadelSessionId = openAtRest(row.zitadelSessionId, this.key, hash);
    const sessionToken = openAtRest(row.sessionToken, this.key, hash);
    if (zitadelSessionId === null || sessionToken === null) return null;
    return {
      session: { zitadelSessionId, sessionToken, sub: row.subject },
      fingerprint: row.fingerprint,
      lastCredentialAt: row.lastCredentialAt,
      lastFinalisedAt: row.lastFinalisedAt,
      expiresAt: row.expiresAt,
    };
  }

  async insert(
    cookieId: string,
    record: Omit<SignInHostRecord, "lastFinalisedAt"> & {
      lastFinalisedAt?: Date;
    },
  ): Promise<void> {
    const hash = cookieIdHash(cookieId);
    await this.db.insert(signInHostRecords).values({
      cookieIdHash: hash,
      subject: record.session.sub,
      zitadelSessionId: sealAtRest(
        record.session.zitadelSessionId,
        this.key,
        hash,
      ),
      sessionToken: sealAtRest(record.session.sessionToken, this.key, hash),
      fingerprint: record.fingerprint,
      lastCredentialAt: record.lastCredentialAt,
      lastFinalisedAt: record.lastFinalisedAt ?? record.lastCredentialAt,
      expiresAt: record.expiresAt,
    });
  }

  /** The idle clock restarts on each finalised authorize; the absolute end never moves. */
  async touchFinalised(cookieId: string, at: Date): Promise<void> {
    await this.db
      .update(signInHostRecords)
      .set({ lastFinalisedAt: at })
      .where(eq(signInHostRecords.cookieIdHash, cookieIdHash(cookieId)));
  }

  async delete(cookieId: string): Promise<void> {
    await this.db
      .delete(signInHostRecords) // retained-data-ok: ephemeral sign-in-host session state (EARS-64), deleted on replace / mismatch / sign-out by design
      .where(eq(signInHostRecords.cookieIdHash, cookieIdHash(cookieId)));
  }

  /**
   * 003 EARS-62 / EARS-10 — the record of `subject` that holds the Zitadel
   * session `zitadelSessionId`, with its row key. The id is sealed with a
   * per-row context, so the lookup narrows by the plain `subject` column (a
   * person holds one record per browser) and opens each candidate.
   */
  async findBySession(
    subject: string,
    zitadelSessionId: string,
  ): Promise<{ hash: string; record: SignInHostRecord } | null> {
    const rows = await this.db
      .select()
      .from(signInHostRecords)
      .where(eq(signInHostRecords.subject, subject));
    for (const row of rows) {
      const id = openAtRest(row.zitadelSessionId, this.key, row.cookieIdHash);
      if (id === null || id !== zitadelSessionId) continue;
      const token = openAtRest(row.sessionToken, this.key, row.cookieIdHash);
      if (token === null) return null;
      return {
        hash: row.cookieIdHash,
        record: {
          session: {
            zitadelSessionId: id,
            sessionToken: token,
            sub: row.subject,
          },
          fingerprint: row.fingerprint,
          lastCredentialAt: row.lastCredentialAt,
          lastFinalisedAt: row.lastFinalisedAt,
          expiresAt: row.expiresAt,
        },
      };
    }
    return null;
  }

  /** 003 EARS-10 — delete the record holding `zitadelSessionId`; returns its session to terminate. */
  async deleteBySession(
    subject: string,
    zitadelSessionId: string,
  ): Promise<IdpSession | null> {
    const found = await this.findBySession(subject, zitadelSessionId);
    if (!found) return null;
    await this.db
      .delete(signInHostRecords) // retained-data-ok: ephemeral sign-in-host session state (EARS-64), deleted on sign-out (EARS-10) by design
      .where(eq(signInHostRecords.cookieIdHash, found.hash));
    return found.record.session;
  }

  /**
   * Every record of `subject`, deleted; returns their sessions to terminate
   * (003 EARS-12 / EARS-41 — every session of the subject ends).
   */
  async deleteBySubject(subject: string): Promise<IdpSession[]> {
    const rows = await this.db
      .delete(signInHostRecords) // retained-data-ok: ephemeral sign-in-host session state (EARS-64), ended with every session of its subject on reset / first verification
      .where(eq(signInHostRecords.subject, subject))
      .returning();
    const sessions: IdpSession[] = [];
    for (const row of rows) {
      const id = openAtRest(row.zitadelSessionId, this.key, row.cookieIdHash);
      const token = openAtRest(row.sessionToken, this.key, row.cookieIdHash);
      if (id !== null && token !== null)
        sessions.push({
          zitadelSessionId: id,
          sessionToken: token,
          sub: row.subject,
        });
    }
    return sessions;
  }

  /**
   * The retention purge: every row past its 30-day end or 7-day idle,
   * decrypted so its Zitadel session can be terminated, then deleted.
   * Returns the sessions to terminate (an envelope that no longer opens has
   * nothing to terminate and is deleted all the same).
   */
  async purgeExpired(now: Date, limit = 500): Promise<IdpSession[]> {
    const idleBefore = new Date(
      now.getTime() - SIGN_IN_HOST_IDLE_SECONDS * 1000,
    );
    const rows = await this.db
      .select()
      .from(signInHostRecords)
      .where(
        or(
          lt(signInHostRecords.expiresAt, now),
          lt(signInHostRecords.lastFinalisedAt, idleBefore),
        ),
      )
      .limit(limit);
    const sessions: IdpSession[] = [];
    for (const row of rows) {
      const id = openAtRest(row.zitadelSessionId, this.key, row.cookieIdHash);
      const token = openAtRest(row.sessionToken, this.key, row.cookieIdHash);
      if (id !== null && token !== null) {
        sessions.push({
          zitadelSessionId: id,
          sessionToken: token,
          sub: row.subject,
        });
      }
      await this.db
        .delete(signInHostRecords) // retained-data-ok: retention purge of expired / idle ephemeral session state (EARS-64)
        .where(eq(signInHostRecords.cookieIdHash, row.cookieIdHash));
    }
    return sessions;
  }
}
