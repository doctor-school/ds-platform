import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import { applications, type DrizzleHandle } from "@ds/db";
import {
  PARTNERSHIP_CONSENT_PURPOSE,
  type PartnershipImportReport,
} from "@ds/schemas";
import { z } from "zod";

import { withRequestAuditContext } from "../audit/audit-context.tx.js";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { APPLICATION_KIND_TABLE } from "./applications.kinds.js";
import { defined } from "./applications.service.js";

type Db = DrizzleHandle["db"];

/** `<uuid>.json` — the interim store's final record name; staging files start with `.`. */
const RECORD_FILE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/i;

/**
 * One stored record of the interim form: the JSON file the retired portal
 * file store wrote per accepted request (`<id>.json` on the
 * `academy_partnership_submissions` volume; runbook
 * `apps/docs/content/operations/academy-partnership-submissions.md`). This
 * schema IS the record shape the import relies on: the fields the queue keeps,
 * read leniently on the rest so the record's own consent snapshot (text, hash,
 * policy) does not need to match byte for byte to be imported.
 */
const InterimRecordSchema = z.object({
  id: z.uuid(),
  acceptedAt: z.iso.datetime({ offset: true }),
  name: z.string(),
  companyOrClinic: z.string().optional(),
  contact: z.string(),
  role: z.string(),
  consent: z.object({
    purpose: z.literal(PARTNERSHIP_CONSENT_PURPOSE),
    versionTag: z.string().min(1).max(200),
    accepted: z.literal(true),
  }),
});

/**
 * 033 EARS-19 — the one-off import of the interim partnership form's stored
 * records into the queue (033-design «Import of the interim records»).
 *
 * Every `<id>.json` of the directory that validates against the `partnership`
 * payload and contact becomes one `applications` row keyed by
 * `legacy_record_id = id`, with the record's submission time and consent tag,
 * status `new` (so the EARS-23 expiry clock runs from the original submission),
 * `team_notice = imported` (no team notice ever goes out for it, and the list
 * marks nothing on it) and `receipt_notice = not_applicable`. An id already
 * present is left as it is, so a re-run imports nothing twice. Staging files
 * (`.…tmp`) are not records and are skipped silently; every other file that
 * does not yield a row is reported by name. A missing or unreadable directory
 * throws before anything is written.
 */
@Injectable()
export class PartnershipRecordsImport {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  async run(directory: string): Promise<PartnershipImportReport> {
    if (!(await stat(directory)).isDirectory())
      throw new Error("the import source is not a directory");
    const names = (await readdir(directory)).filter((n) => !n.startsWith("."));
    names.sort();

    const report: PartnershipImportReport = {
      imported: 0,
      alreadyPresent: 0,
      invalid: [],
    };
    for (const name of names) {
      const row = await this.readRecord(directory, name);
      if (!row) {
        report.invalid.push(name);
        continue;
      }
      const inserted = await withRequestAuditContext(this.db, (tx) =>
        tx
          .insert(applications)
          .values(row)
          .onConflictDoNothing({ target: applications.legacyRecordId })
          .returning({ id: applications.id }),
      );
      if (inserted.length === 1) report.imported++;
      else report.alreadyPresent++;
    }
    return report;
  }

  private async readRecord(
    directory: string,
    name: string,
  ): Promise<typeof applications.$inferInsert | null> {
    const fileId = RECORD_FILE.exec(name)?.[1];
    if (!fileId) return null;
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(join(directory, name), "utf8"));
    } catch {
      return null;
    }
    const record = InterimRecordSchema.safeParse(raw);
    if (
      !record.success ||
      record.data.id.toLowerCase() !== fileId.toLowerCase()
    )
      return null;

    const kind = APPLICATION_KIND_TABLE.partnership;
    const payload = kind.payloadSchema.safeParse(
      defined({
        name: record.data.name,
        companyOrClinic: record.data.companyOrClinic || undefined,
        role: record.data.role,
      }),
    );
    const contact = kind.contactSchema.safeParse({
      emailOrTelegram: record.data.contact,
    });
    if (!payload.success || !contact.success) return null;

    return {
      kind: "partnership",
      payload: defined(payload.data),
      contact: contact.data,
      subjectLine: kind.subjectLine(payload.data),
      consentPurpose: record.data.consent.purpose,
      consentVersionTag: record.data.consent.versionTag,
      legacyRecordId: record.data.id,
      submittedAt: new Date(record.data.acceptedAt),
      teamNotice: "imported",
      receiptNotice: "not_applicable",
    };
  }
}
