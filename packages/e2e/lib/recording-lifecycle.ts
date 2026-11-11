import { expect } from "@playwright/test";
import type { LegacyAnswer } from "./legacy-transition.js";

type Row = Record<string, unknown>;
export const originOutline =
  "Each event is routed to exactly one lifecycle by its immutable origin";
export const legacyBarTitle =
  "The lifecycle bar renders only the event's own machine";
export const originMachines = {
  platform: ["draft", "published", "live", "ended", "hidden"],
  legacy: ["hidden", "in_archive"],
} as const;
export const foreignCommands = {
  platform: ["archive-legacy", "hide-legacy"],
  legacy: ["publish", "open", "close", "hide"],
} as const;
export function foreignLifecycleAttempts(
  origin: "platform" | "legacy",
): string[] {
  const own: readonly string[] = originMachines[origin];
  return [
    ...foreignCommands[origin],
    ...originMachines[origin === "platform" ? "legacy" : "platform"]
      .filter((state) => !own.includes(state))
      .map((state) => `transition:${state}`),
  ];
}
export type OriginReceipt = {
  origin: "platform" | "legacy";
  machine: string;
  states: {
    before: Row;
    after: Row;
    validTransitions: string[];
    refusals: { command: string; answer: LegacyAnswer }[];
  }[];
  update: {
    before: Row;
    after: Row;
    suppliedOrigin: string;
    answer: LegacyAnswer;
    control: LegacyAnswer;
    controlAfter: Row;
  };
};
export type LegacyBarReceipt = {
  states: {
    id: string;
    origin: string;
    state: string;
    recording: Row;
    validTransitions: string[];
    labels: string[];
    controls: string[];
    transport: string;
  }[];
};
function assertProtocol(
  answer: LegacyAnswer,
  id: unknown,
  version: unknown,
  route = "",
) {
  expect(answer.request).toMatchObject({
    method: route ? "POST" : "PATCH",
    path: `/v1/admin/events/${id}${route ? `/${route}` : ""}`,
    ifMatch: `W/"${version}"`,
    transport: "api",
  });
  expect(answer.request.idempotencyKey).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
}
// 014 EARS-23: literal source-machine expectations, independent of server maps.
export function assertOriginReceipt(
  r: OriginReceipt,
  origin: "platform" | "legacy",
) {
  expect(r.origin).toBe(origin);
  const machine = originMachines[origin];
  expect(r.machine.split(",").map((s) => s.trim())).toEqual(machine);
  expect(r.states.map((s) => s.before.state)).toEqual(machine);
  for (const [index, state] of r.states.entries()) {
    expect(state.before).toMatchObject({ origin, state: machine[index] });
    expect(typeof state.before.id).toBe("string");
    expect(state.after).toEqual(state.before);
    const next =
      origin === "legacy"
        ? [machine[index === 0 ? 1 : 0]]
        : machine[index + 1]
          ? [machine[index + 1]]
          : [];
    expect(state.validTransitions).toEqual(next);
    expect(state.refusals.map((x) => x.command)).toEqual(
      foreignLifecycleAttempts(origin),
    );
    for (const refusal of state.refusals) {
      assertProtocol(
        refusal.answer,
        state.before.id,
        state.before.version,
        refusal.command.split(":")[0],
      );
      expect(refusal.answer.status).toBe(409);
      expect(refusal.answer.body.errorCode ?? refusal.answer.body.code).toBe(
        "INVALID_TRANSITION",
      );
      if (refusal.command.startsWith("transition:"))
        expect(refusal.answer.body.to).toBe(refusal.command.split(":")[1]);
    }
  }
  const u = r.update;
  expect(u.before.origin).toBe(origin);
  expect(u.suppliedOrigin).toBe(origin === "platform" ? "legacy" : "platform");
  assertProtocol(u.answer, u.before.id, u.before.version);
  expect(u.answer.status).toBe(400);
  expect(u.answer.body).toMatchObject({
    message: "invalid event payload",
    issues: expect.arrayContaining([
      expect.objectContaining({ path: ["origin"], expected: "never" }),
    ]),
  });
  expect(u.after).toEqual(u.before);
  assertProtocol(u.control, u.before.id, u.before.version);
  expect(u.control.status).toBe(200);
  expect(u.controlAfter).toMatchObject({
    id: u.before.id,
    origin,
    state: u.before.state,
    version: Number(u.before.version) + 1,
    title: "Control",
  });
  expect(u.control.body).toMatchObject({ origin, title: "Control" });
}
// 014 EARS-27: browser controls must agree with both source labels and API detail.
export function assertLegacyBarReceipt(r: LegacyBarReceipt) {
  expect(r.states.map((s) => s.state)).toEqual(["hidden", "in_archive"]);
  for (const [index, state] of r.states.entries()) {
    expect(state.origin).toBe("legacy");
    expect(state.id).toBeTruthy();
    expect(state.transport).toBe("browser");
    expect(state.recording).toMatchObject({
      status: "published",
      deleted_at: null,
    });
    expect(state.validTransitions).toEqual([
      index === 0 ? "in_archive" : "hidden",
    ]);
    expect(state.labels).toEqual([index === 0 ? "Архивировать" : "Скрыть"]);
    expect(state.controls).toEqual([
      index === 0 ? "action-archive-legacy" : "action-hide-legacy",
    ]);
  }
}
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
