import type { Logger } from "@nestjs/common";
import { type DrizzleHandle, users } from "@ds/db";
import type {
  LearningNoticePort,
  LearningSchoolOpenedNotice,
} from "@ds/learning/server";
import { inArray } from "drizzle-orm";
import type { Mailer } from "../mailer/mailer.types.js";
import { doctorStorefrontOrigin } from "../taxonomy/doctor-storefront-origin.js";

/**
 * 023 EARS-7 — the host half of the school-opened notice: resolve each claimed
 * doctor's account email and send the product notice through the `Mailer`
 * (023-design §6). The package has already set `notified_at` in the committed
 * publication; this sender runs off the publish response path (like the
 * congress receipt), so a slow relay never holds the response and no lookup or
 * relay failure turns a committed publication into a failed one. A rejected
 * letter is logged by person id (never the address) and never retried — the
 * doctor gets the notice at most once; a failed lookup is logged with the
 * count of letters it left unsent.
 */
export function learningNoticeSender(
  db: DrizzleHandle["db"],
  mailer: Mailer,
  logger: Pick<Logger, "warn" | "error">,
  env: NodeJS.ProcessEnv = process.env,
): LearningNoticePort {
  async function send(notices: LearningSchoolOpenedNotice[]): Promise<void> {
    const origin = doctorStorefrontOrigin(env);
    const rows = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(
        inArray(
          users.id,
          notices.map((n) => n.personId),
        ),
      );
    const emailOf = new Map(rows.map((r) => [r.id, r.email] as const));
    for (const notice of notices) {
      const schoolUrl = new URL(
        `/schools/${encodeURIComponent(notice.school.slug)}`,
        origin,
      ).toString();
      try {
        await mailer.sendSchoolOpenedNotice({
          email: emailOf.get(notice.personId) ?? "",
          schoolTitle: notice.school.title,
          courseTitle: notice.course.title,
          schoolUrl,
        });
      } catch {
        // The mailer's own diagnostics carry the sanitized provider outcome;
        // re-logging the error could put the recipient address in a log line.
        logger.warn(
          `school-opened notice rejected for person ${notice.personId}`,
        );
      }
    }
  }

  return {
    schoolOpened(notices: LearningSchoolOpenedNotice[]): void {
      if (notices.length === 0) return;
      void send(notices).catch((err: unknown) => {
        logger.error(
          `school-opened notices not sent (${notices.length}): ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    },
  };
}
