import { Inject, Injectable } from "@nestjs/common";
import type { DrizzleHandle } from "@ds/db";
import { presenceBeats, users } from "@ds/db";
import { eq } from "drizzle-orm";
import { DRIZZLE_DB } from "../database/database.tokens.js";

type Db = DrizzleHandle["db"];

/**
 * Data access for the 006 EARS-4 durable append-only presence capture (design
 * §5; ADR-0003 §3). Its ONLY write is an INSERT — there is no update or delete
 * surface, which is the structural half of the append-only contract (the other
 * half is the table shape: `presence_beats` has no mutable column). It reads the
 * `users` mirror (003) read-only to resolve the authenticated `sub` to the
 * domain `user_id` the beat is attributed to (the same thin pattern the 005
 * `RegistrationRepository.findUserIdBySub` uses) and appends one immutable
 * `(user_id, event_id, beat_at)` row per accepted beat.
 *
 * RoomModule-local so the gated command carries no cross-module service
 * injection for its own write (F-22 boundary); the `registered ∧ live` gate is
 * evaluated in {@link RoomService} (reusing the 005 roster read) BEFORE this
 * append is ever reached — an ungated caller never touches this table.
 */
@Injectable()
export class PresenceRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /**
   * Resolve the authenticated Zitadel `sub` to its domain `users.id` (the 003
   * mirror row). `null` when no mirror exists — the caller maps that to a
   * refusal (401) rather than inventing a row (EARS-8). Read-only.
   */
  async findUserIdBySub(sub: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.zitadelSub, sub))
      .limit(1);
    return row?.id ?? null;
  }

  /**
   * Append exactly one immutable presence beat for `(userId, eventId)` and return
   * the row's server-stamped canonical instant. INSERT-only — the append-only
   * contract (no update path). `beat_at` defaults to the server clock, so the
   * instant is server-authoritative, never client-supplied (requirements
   * Constraints). Every call is a NEW row (never an upsert): concurrent-tab
   * coalescing is an EARS-5 read-time derivation over the raw beats, not a write
   * suppression here.
   */
  async appendBeat(userId: string, eventId: string): Promise<{ beatAt: Date }> {
    const [row] = await this.db
      .insert(presenceBeats)
      .values({ userId, eventId })
      .returning({ beatAt: presenceBeats.beatAt });
    // A single-row INSERT always returns one row; the guard is fail-closed
    // defence, never a silent no-op that would lose a captured beat.
    if (!row) throw new Error("presence beat insert returned no row");
    return { beatAt: row.beatAt };
  }
}
