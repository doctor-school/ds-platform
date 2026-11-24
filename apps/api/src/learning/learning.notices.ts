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
 * publication, so a rejected letter is logged by person id (never the address)
 * and never retried — the doctor gets the notice at most once.
 */
export function learningNoticeSender(
  db: DrizzleHandle["db"],
  mailer: Mailer,
  logger: Pick<Logger, "warn" | "error">,
  env: NodeJS.ProcessEnv = process.env,
): LearningNoticePort {
  return {
    async schoolOpened(notices: LearningSchoolOpenedNotice[]): Promise<void> {
      if (notices.length === 0) return;
      let origin: string;
      try {
        origin = doctorStorefrontOrigin(env);
      } catch (err) {
        // The publication has committed: a missing origin is reported loudly
        // by name, never turned into a failed publish response.
        logger.error(
          `school-opened notices not sent (${notices.length}): ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }
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
          logger.warn(
            `school-opened notice rejected for person ${notice.personId}`,
          );
        }
      }
    },
  };
}
