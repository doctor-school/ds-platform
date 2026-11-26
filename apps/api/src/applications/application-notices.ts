import { Inject, Injectable, Logger } from "@nestjs/common";
import { applications, type DrizzleHandle, users } from "@ds/db";
import type { ApplicationKind } from "@ds/schemas";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { withRequestAuditContext } from "../audit/audit-context.tx.js";
import { IDP_CLIENT, type IdpClient } from "../auth/idp/idp.types.js";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { MAILER, type Mailer } from "../mailer/mailer.types.js";
import {
  APPLICATION_KIND_TABLE,
  type ApplicationKindDefinition,
} from "./applications.kinds.js";

type Db = DrizzleHandle["db"];

/** 033 EARS-11 — the team notice outcome recorded on the row. */
export type TeamNoticeOutcome = "sent" | "failed" | "skipped";
/** 033 EARS-12 — the receipt outcome recorded on the row. */
export type ReceiptNoticeOutcome = "sent" | "failed" | "not_applicable";

/** What the intake knows of the row it just committed. */
export interface CommittedApplication {
  id: string;
  kind: ApplicationKind;
  submittedAt: Date;
  /** The applicant account (`author`); `null` for a no-account kind. */
  applicantUserId: string | null;
  /** The no-account kinds' stored contact; `null` for an account kind. */
  contact: unknown;
}

/** The 047 role whose holders work the queue (033-design decision 8). */
export const TEAM_NOTICE_ROLE = "platform_admin";

/**
 * 033 EARS-12 — the receipt recipient the kind names: the applicant account's
 * email for `account-email`, the contact email the intake carries for
 * `contact-email`, and `null` («not applicable») for a kind with no receipt.
 * An `undefined` return means the kind has a receipt but the address is
 * missing — a `failed` send, never a silent `not_applicable`.
 */
export function receiptRecipient(
  receiptTo: ApplicationKindDefinition["receiptTo"],
  source: { accountEmail: string | null; contact: unknown },
): string | null | undefined {
  if (receiptTo === null) return null;
  if (receiptTo === "account-email") return source.accountEmail ?? undefined;
  const contact = source.contact;
  if (contact && typeof contact === "object" && "email" in contact) {
    const email = (contact as { email: unknown }).email;
    if (typeof email === "string" && email.trim()) return email;
  }
  return undefined;
}

/**
 * The configured Academy public origin (`ACADEMY_PUBLIC_ORIGIN`, the shared
 * `api.env` contract), read at send time. Unset is a refusal by name.
 */
export function academyPublicOrigin(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const value = env.ACADEMY_PUBLIC_ORIGIN?.trim();
  if (!value) throw new Error("ACADEMY_PUBLIC_ORIGIN is required");
  return new URL(value).origin;
}

/**
 * The admin app's origin, derived from the Academy origin: every deployed
 * environment serves the admin as the `admin` sibling of the `academy` host
 * (`academy.doctor.school` → `admin.doctor.school`, slot
 * `academy-pr-7.<base>` → `admin-pr-7.<base>`), so the team notice needs no
 * configuration of its own (033 EARS-11). An Academy host that does not start
 * with the `academy` label is refused by name — never a guessed link.
 */
export function adminOriginOf(academyOrigin: string): string {
  const url = new URL(academyOrigin);
  const [first, ...rest] = url.hostname.split(".");
  const match = /^academy(-[a-z0-9-]+)?$/.exec(first ?? "");
  if (!match || rest.length === 0)
    throw new Error(
      `cannot derive the admin origin from ACADEMY_PUBLIC_ORIGIN host ${url.hostname}`,
    );
  url.hostname = [`admin${match[1] ?? ""}`, ...rest].join(".");
  return url.origin;
}

/**
 * 033 EARS-11, EARS-12 — the after-commit sends of a committed application
 * (033-design «Intake and notification sequence», decision 9): one team notice
 * to every active `platform_admin`, one «Заявка получена» to the kind's
 * receipt recipient, each attempted once through the mailer chain's failover
 * and its outcome recorded on the row. Runs off the response path: no send,
 * lookup or record failure reaches the intake's answer, and an outcome that
 * could not be recorded stays `pending` — «Команда не уведомлена» in the list.
 */
@Injectable()
export class ApplicationNotices {
  private readonly logger = new Logger(ApplicationNotices.name);

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(IDP_CLIENT) private readonly idp: IdpClient,
  ) {}

  /** Fire the sends for a freshly committed row; never throws, never waits. */
  afterCommit(committed: CommittedApplication): void {
    void this.send(committed).catch((err: unknown) => {
      this.logger.error(
        `application ${committed.id} notices not recorded: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  private async send(committed: CommittedApplication): Promise<void> {
    const [teamNotice, receiptNotice] = await Promise.all([
      this.notifyTeam(committed),
      this.sendReceipt(committed),
    ]);
    await withRequestAuditContext(this.db, (tx) =>
      tx
        .update(applications)
        .set({ teamNotice, receiptNotice })
        .where(eq(applications.id, committed.id)),
    );
  }

  private async notifyTeam(
    committed: CommittedApplication,
  ): Promise<TeamNoticeOutcome> {
    try {
      const recipients = await this.teamRecipients();
      if (recipients.length === 0) return "skipped";
      const adminUrl = new URL(
        `/applications/${encodeURIComponent(committed.id)}`,
        adminOriginOf(academyPublicOrigin()),
      ).toString();
      let outcome: TeamNoticeOutcome = "sent";
      for (const email of recipients) {
        try {
          await this.mailer.sendApplicationTeamNotice({
            email,
            kindLabel: APPLICATION_KIND_TABLE[committed.kind].label,
            submittedAt: committed.submittedAt,
            adminUrl,
          });
        } catch {
          // The mailer's diagnostics carry the sanitized provider outcome;
          // re-logging the error could put the address in a log line.
          outcome = "failed";
        }
      }
      if (outcome === "failed")
        this.logger.warn(`application ${committed.id} team notice failed`);
      return outcome;
    } catch (err) {
      this.logger.warn(
        `application ${committed.id} team notice failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return "failed";
    }
  }

  private async sendReceipt(
    committed: CommittedApplication,
  ): Promise<ReceiptNoticeOutcome> {
    const { receiptTo }: Pick<ApplicationKindDefinition, "receiptTo"> =
      APPLICATION_KIND_TABLE[committed.kind];
    if (receiptTo === null) return "not_applicable";
    try {
      const email = receiptRecipient(receiptTo, {
        accountEmail: await this.accountEmail(committed.applicantUserId),
        contact: committed.contact,
      });
      if (!email) throw new Error("the receipt recipient has no email");
      const projectsUrl = new URL(
        "/projects",
        academyPublicOrigin(),
      ).toString();
      await this.mailer.sendApplicationReceipt({ email, projectsUrl });
      return "sent";
    } catch {
      this.logger.warn(`application ${committed.id} receipt failed`);
      return "failed";
    }
  }

  /**
   * The emails of the active staff accounts holding `platform_admin`, read at
   * send time: the IdP grant is the authority for who holds the role (047),
   * the mirror says whether the account is active — not deactivated in the
   * IdP (`deactivated_at`) and not a retired record (`record_status`) — and
   * gives its email.
   */
  private async teamRecipients(): Promise<string[]> {
    const holders = (
      await this.idp.listProjectGrantsWithRoles([TEAM_NOTICE_ROLE])
    ).filter((h) => h.roleKeys.includes(TEAM_NOTICE_ROLE));
    if (holders.length === 0) return [];
    const rows = await this.db
      .select({ email: users.email })
      .from(users)
      .where(
        and(
          inArray(
            users.zitadelSub,
            holders.map((h) => h.sub),
          ),
          isNull(users.deactivatedAt),
          eq(users.recordStatus, "active"),
        ),
      );
    return [
      ...new Set(
        rows.map((r) => r.email?.trim()).filter((e): e is string => Boolean(e)),
      ),
    ];
  }

  private async accountEmail(userId: string | null): Promise<string | null> {
    if (!userId) return null;
    const [row] = await this.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row?.email ?? null;
  }
}
