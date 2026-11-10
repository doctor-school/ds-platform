import { expect } from "@playwright/test";

type Row = Record<string, unknown>;
export type LifecycleRecording = {
  id: string;
  kind: string;
  version: number;
  status: string;
  deletedAt: string | null;
};
type Event = { id: string; slug: string };
type Answer = {
  status: number;
  body: LifecycleRecording & { errorCode?: string };
};
export interface RecordingLifecycleDriver {
  event(state?: string): Promise<Event>;
  attach(event: Event, kind: string): Promise<LifecycleRecording>;
  command(
    event: Event,
    row: LifecycleRecording,
    action: string,
  ): Promise<LifecycleRecording>;
  publish(event: Event, row: LifecycleRecording): Promise<Answer>;
  sql(text: string, values?: unknown[]): Promise<Row[]>;
  actor(): string;
}

// 014 EARS-2 / EARS-17; the host supplies its real session and owning DB adapter.
export class RecordingLifecycleProof {
  event?: Event;
  recording?: LifecycleRecording;
  original?: Row;
  eventBefore?: Row[];
  firstPublishedAt?: unknown;
  answer?: Answer;
  evidence: unknown[] = [];
  constructor(private readonly driver: RecordingLifecycleDriver) {}

  async snapshot(id: string): Promise<Row> {
    const rows = await this.driver.sql(
      "SELECT to_jsonb(r) AS row FROM event_recordings r WHERE id=$1",
      [id],
    );
    expect(rows).toHaveLength(1);
    return rows[0]!.row as Row;
  }
  async draft(lifecycle = "ended") {
    this.event = await this.driver.event(lifecycle);
    this.eventBefore = await this.driver.sql(
      "SELECT * FROM events WHERE id=$1",
      [this.event.id],
    );
    expect(this.eventBefore).toMatchObject([
      { origin: "platform", state: lifecycle },
    ]);
    this.recording = await this.driver.attach(this.event, "edited");
    this.original = await this.snapshot(this.recording.id);
    expect(this.original).toMatchObject({
      status: "draft",
      version: 1,
      first_published_at: null,
    });
  }
  async publish() {
    this.recording = await this.driver.command(
      this.event!,
      this.recording!,
      "publish",
    );
  }
  async timestamp() {
    const row = await this.snapshot(this.recording!.id);
    expect(row).toMatchObject({ status: "published", version: 2 });
    expect(typeof row.first_published_at).toBe("string");
    expect(Number.isFinite(Date.parse(row.first_published_at as string))).toBe(
      true,
    );
    this.firstPublishedAt = row.first_published_at;
    this.evidence.push({ attached: this.original, published: row });
  }
  async unchangedEvent() {
    expect(
      await this.driver.sql("SELECT * FROM events WHERE id=$1", [
        this.event!.id,
      ]),
    ).toEqual(this.eventBefore);
  }
  async republish() {
    this.recording = await this.driver.command(
      this.event!,
      this.recording!,
      "unpublish",
    );
    const unpublished = await this.snapshot(this.recording.id);
    expect(unpublished).toMatchObject({
      status: "draft",
      first_published_at: this.firstPublishedAt,
    });
    this.evidence.push({ unpublished });
    await this.publish();
  }
  async originalTimestamp() {
    const republished = await this.snapshot(this.recording!.id);
    expect(republished).toMatchObject({
      status: "published",
      version: 4,
      first_published_at: this.firstPublishedAt,
    });
    await this.unchangedEvent();
    this.evidence.push({ republished });
  }
  async attemptPublish() {
    this.answer = await this.driver.publish(this.event!, this.recording!);
  }
  async rejected() {
    expect(this.answer!.status).toBe(409);
    expect(this.answer!.body.errorCode).toBe("EVENT_NOT_FINISHED");
  }
  async unchangedDraft() {
    const after = await this.snapshot(this.recording!.id);
    expect(after).toEqual(this.original);
    await this.unchangedEvent();
    this.evidence.push({
      event: this.eventBefore,
      before: this.original,
      refusal: this.answer,
      after,
    });
  }
  async genericAudit() {
    const triggers = await this.driver.sql(
      "SELECT p.proname FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='event_recordings'::regclass AND NOT t.tgisinternal",
    );
    expect(triggers).toContainEqual({ proname: "audit_row_change" });
    this.evidence.push({ triggers });
  }
  async auditedMutations() {
    this.event = await this.driver.event();
    let before: Row | undefined;
    let previousAudit: Row[] = [];
    for (const action of [
      "attach",
      "publish",
      "unpublish",
      "retire",
      "restore",
    ]) {
      this.recording =
        action === "attach"
          ? await this.driver.attach(this.event, "edited")
          : await this.driver.command(this.event, this.recording!, action);
      const after = await this.snapshot(this.recording.id);
      const rows = await this.driver.sql(
        "SELECT id,event_type,subject_id,metadata FROM audit_ledger WHERE metadata->>'table'='event_recordings' AND metadata->'pk'->>'id'=$1",
        [this.recording.id],
      );
      const added = rows.filter(
        (r) => !previousAudit.some((old) => old.id === r.id),
      );
      expect(rows).toHaveLength(previousAudit.length + 1);
      expect(added).toHaveLength(1);
      const audit = added[0]!;
      const diff = Object.fromEntries(
        Object.entries(after)
          .filter(
            ([key, value]) =>
              !before ||
              (key !== "updated_at" &&
                JSON.stringify(before[key]) !== JSON.stringify(value)),
          )
          .map(([key, value]) => [
            key,
            before ? { old: before[key], new: value } : { new: value },
          ]),
      );
      expect(audit).toMatchObject({
        event_type: `data.event_recordings.${action === "attach" ? "insert" : "update"}`,
        subject_id: this.driver.actor(),
      });
      const metadata = audit.metadata as Row;
      expect(metadata).toMatchObject({
        table: "event_recordings",
        pk: { id: this.recording.id },
        source: "admin-ui",
      });
      expect(metadata.diff).toEqual(diff);
      expect(metadata.txid).toMatch(/^\d+$/);
      expect(after.status).toBe(
        (
          {
            attach: "draft",
            publish: "published",
            unpublish: "draft",
            retire: "retired",
            restore: "draft",
          } as Record<string, string>
        )[action],
      );
      this.evidence.push({ action, before, after, audit });
      before = after;
      previousAudit = rows;
    }
  }
  async auditCount() {
    expect(this.evidence.filter((e) => (e as Row).audit)).toHaveLength(5);
  }
  async noSpecificAuditTable() {
    const tables = await this.driver.sql(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name ~ '(recording.*audit|audit.*recording)'",
    );
    expect(tables).toEqual([]);
    this.evidence.push({ recordingAuditTables: tables });
  }
}
