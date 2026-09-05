import { randomUUID } from "node:crypto";
import type pg from "pg";

/**
 * 012 EARS-24 (#1607) — speaker fixtures for the post-cutover world.
 *
 * Before the cutover release a suite that needed "this event has speakers"
 * inserted free-text `event_speakers` rows. That table no longer exists: the
 * ONLY speaker source is an ACTIVE `event_experts` link to an ELIGIBLE
 * (published, non-retired) `experts` row. Every suite that seeds speakers now
 * seeds that pair, so the shape is written down once, here, rather than
 * re-derived in a dozen suites.
 *
 * Test infrastructure only — no production path calls these.
 */

/** One speaker to seed, in the caller's intended display order. */
export interface SpeakerFixture {
  /** Family name — the first component of the projected `name`. */
  familyName: string;
  /** Given name (and patronymic, if the suite wants one). */
  givenName: string;
  /** Optional credentials; the public item renders `""` when absent. */
  credentials?: string;
  /** The link role; defaults to the ordinary «Спикер». */
  role?: string;
}

/** The `name` the public projection builds for a fixture — `concat_ws(' ', …)`. */
export function projectedSpeakerName(speaker: SpeakerFixture): string {
  return `${speaker.familyName} ${speaker.givenName}`;
}

/**
 * Seed `speakers` as published experts linked to `eventId` at positions
 * `0..n-1`. Returns the created expert ids so the suite can sweep them in its
 * teardown (`deleteExpertFixtures`) — `deleteEventFixture` removes the LINKS
 * but cannot know which experts the suite owns.
 */
export async function seedEventSpeakers(
  pool: pg.Pool,
  eventId: string,
  speakers: SpeakerFixture[],
): Promise<string[]> {
  const expertIds: string[] = [];
  for (const [position, speaker] of speakers.entries()) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO experts
         (slug, family_name, given_name, credentials, status, first_published_at)
       VALUES ($1, $2, $3, $4, 'published', now()) RETURNING id`,
      [
        `x-fixture-${randomUUID()}`,
        speaker.familyName,
        speaker.givenName,
        speaker.credentials ?? null,
      ],
    );
    const expertId = rows[0]!.id;
    expertIds.push(expertId);
    await pool.query(
      `INSERT INTO event_experts (event_id, expert_id, role, position, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [eventId, expertId, speaker.role ?? "Спикер", position],
    );
  }
  return expertIds;
}

/**
 * Remove expert fixtures once their links are gone. Safe for an id that no
 * longer exists.
 */
export async function deleteExpertFixtures(
  pool: pg.Pool,
  expertIds: string[],
): Promise<void> {
  for (const id of expertIds)
    await pool.query("DELETE FROM experts WHERE id = $1", [id]);
}
