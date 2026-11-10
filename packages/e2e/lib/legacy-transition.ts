import { expect } from "@playwright/test";

type Row = Record<string, unknown>;
export const legacyTitles = [
  "An archival broadcast with a published recording is archived",
  "An archival broadcast with nothing to play cannot be archived",
  "An archived broadcast is hidden again",
] as const;
export type LegacyAnswer = {
  status: number;
  body: Row;
  request: {
    method: string;
    path: string;
    ifMatch: string;
    idempotencyKey: string;
    transport: string;
  };
};
export type PublicListBody = {
  data: Row[];
  counts: { past: number; upcoming: number };
  horizon: { today: string };
};
export type PublicLists = {
  query: string;
  body: PublicListBody | Row[];
}[];
export type LegacyReceipt = {
  identity: string;
  actor: string;
  fixture: {
    id: string;
    slug: string;
    heldAtMsk: string;
    horizonToday: string;
    audience: string;
    recording: Row;
  };
  before: Row;
  after: Row;
  auditBefore: Row[];
  auditAfter: Row[];
  answer: LegacyAnswer;
  absentAction?: boolean;
  publicBefore?: PublicLists | undefined;
  publicAfter?: PublicLists | undefined;
  hiddenNotice?: boolean;
};
function addedRows(receipt: LegacyReceipt) {
  return receipt.auditAfter.filter(
    (row) => !receipt.auditBefore.some((old) => old.id === row.id),
  );
}
export function assertLegacyReceipt(receipt: LegacyReceipt, title: string) {
  if (
    !receipt ||
    receipt.identity !== title ||
    !receipt.actor ||
    !legacyTitles.includes(title as (typeof legacyTitles)[number])
  )
    throw new Error("Legacy identity/actor mismatch");
  const { fixture, before, after, answer } = receipt;
  const refusal = title === legacyTitles[1];
  const hide = title === legacyTitles[2];
  const from = hide ? "in_archive" : "hidden",
    to = hide ? "hidden" : "in_archive";
  if (
    !fixture ||
    fixture.audience !== "experts" ||
    before.id !== fixture.id ||
    after.id !== fixture.id ||
    before.origin !== "legacy" ||
    before.state !== from ||
    before.audience !== "experts"
  )
    throw new Error("Legacy fixture/state identity mismatch");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(fixture.horizonToday) ||
    fixture.heldAtMsk.slice(0, 10) >= fixture.horizonToday ||
    !fixture.slug
  )
    throw new Error("Legacy public horizon mismatch");
  if (
    fixture.recording.status !== (refusal ? "draft" : "published") ||
    fixture.recording.deletedAt !== null
  )
    throw new Error("Legacy recording state mismatch");
  const request = answer.request;
  if (
    request.method !== "POST" ||
    request.path !==
      `/v1/admin/events/${fixture.id}/${hide ? "hide-legacy" : "archive-legacy"}` ||
    request.ifMatch !== `W/"${before.version}"` ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      request.idempotencyKey,
    ) ||
    request.transport !== (refusal ? "api" : "admin-click")
  )
    throw new Error("Legacy protocol mismatch");
  const added = addedRows(receipt);
  if (refusal) {
    if (
      answer.status !== 409 ||
      (answer.body.errorCode ?? answer.body.code) !== "EVENT_NOT_FINISHED" ||
      !receipt.absentAction ||
      JSON.stringify(before) !== JSON.stringify(after) ||
      JSON.stringify(receipt.auditBefore) !== JSON.stringify(receipt.auditAfter)
    )
      throw new Error(
        "Legacy refusal changed state/audit or missed absent action",
      );
    return;
  }
  if (
    answer.status !== 200 ||
    answer.body.state !== to ||
    after.state !== to ||
    after.origin !== "legacy" ||
    after.version !== Number(before.version) + 1
  )
    throw new Error("Legacy resulting state mismatch");
  const named = added.filter(
    (row) => row.event_type === `event.${hide ? "hidden" : "archived"}_legacy`,
  );
  const namedMetadata = named[0]?.metadata as Row | undefined;
  if (
    named.length !== 1 ||
    named[0]!.subject_id !== receipt.actor ||
    !namedMetadata ||
    Object.keys(namedMetadata).length !== 3 ||
    namedMetadata.aggregateId !== fixture.id ||
    namedMetadata.from !== from ||
    namedMetadata.to !== to
  )
    throw new Error("Legacy named audit mismatch");

  if (
    added.some(
      (row) =>
        row.event_type === "event.ended" || row.event_type === "event.hidden",
    )
  )
    throw new Error("Legacy terminal audit mismatch");
  const generic = added.filter(
    (row) => row.event_type === "data.events.update",
  );
  if (
    added.length !== 2 ||
    generic.length !== 1 ||
    generic[0]!.subject_id !== receipt.actor
  )
    throw new Error("Legacy audit delta mismatch");
  const metadata = generic[0]!.metadata as Row;
  const diff = Object.fromEntries(
    Object.entries(after)
      .filter(
        ([key, value]) =>
          key !== "updated_at" &&
          JSON.stringify(before[key]) !== JSON.stringify(value),
      )
      .map(([key, value]) => [key, { old: before[key], new: value }]),
  );
  expect(metadata).toMatchObject({
    table: "events",
    pk: { id: fixture.id },
    source: "admin-ui",
  });
  expect(metadata.diff).toEqual(diff);
  expect(metadata.txid).toMatch(/^\d+$/);
  if (hide) {
    if (
      !receipt.hiddenNotice ||
      receipt.publicBefore?.length !== 3 ||
      receipt.publicAfter?.length !== 3
    )
      throw new Error("Legacy public exclusion missing");
    for (let index = 0; index < 3; index++) {
      const pre = receipt.publicBefore[index]!,
        post = receipt.publicAfter[index]!;
      if (
        pre.query !== ["timeframe=upcoming", "timeframe=past", ""][index] ||
        post.query !== pre.query ||
        JSON.stringify(post.body).includes(fixture.id) ||
        JSON.stringify(post.body).includes(fixture.slug)
      )
        throw new Error("Legacy public exclusion mismatch");
      if (index === 2) {
        if (!Array.isArray(pre.body) || !Array.isArray(post.body))
          throw new Error("Legacy default listing mismatch");
        continue;
      }
      if (Array.isArray(pre.body) || Array.isArray(post.body))
        throw new Error("Legacy horizon listing mismatch");
      if (
        pre.body.horizon.today !== fixture.horizonToday ||
        post.body.horizon.today !== fixture.horizonToday ||
        post.body.counts.past !== pre.body.counts.past - 1 ||
        post.body.counts.upcoming !== pre.body.counts.upcoming
      )
        throw new Error("Legacy public count/exclusion mismatch");
      if (index === 1 && !pre.body.data.some((row) => row.id === fixture.id))
        throw new Error("Legacy fixture not visible before hide");
    }
  }
}
export interface LegacyDriver {
  create(published: boolean): Promise<LegacyReceipt["fixture"]>;
  snapshot(id: string): Promise<Row>;
  audits(id: string): Promise<Row[]>;
  transition(
    id: string,
    command: string,
    version: number,
    click: boolean,
  ): Promise<LegacyAnswer>;
  absentAction(id: string): Promise<boolean>;
  publicLists(): Promise<PublicLists>;
  hiddenNotice(slug: string): Promise<boolean>;
  actor(): string;
}
// 014 EARS-25: host adapters own transport, the canonical proof owns assertions.
export class LegacyTransitionProof {
  receipt?: LegacyReceipt;
  constructor(private readonly driver: LegacyDriver) {}
  async prepare(title: string) {
    const fixture = await this.driver.create(title !== legacyTitles[1]);
    if (title === legacyTitles[2]) {
      const before = await this.driver.snapshot(fixture.id);
      expect(
        (
          await this.driver.transition(
            fixture.id,
            "archive-legacy",
            Number(before.version),
            false,
          )
        ).status,
      ).toBe(200);
    }
    this.receipt = {
      identity: title,
      actor: this.driver.actor(),
      fixture,
      before: await this.driver.snapshot(fixture.id),
      after: {},
      auditBefore: await this.driver.audits(fixture.id),
      auditAfter: [],
      answer: undefined as unknown as LegacyAnswer,
    };
    if (title === legacyTitles[2])
      this.receipt.publicBefore = await this.driver.publicLists();
    if (title === legacyTitles[1])
      this.receipt.absentAction = await this.driver.absentAction(fixture.id);
  }
  async invoke(hide = false) {
    const receipt = this.receipt!;
    receipt.answer = await this.driver.transition(
      receipt.fixture.id,
      hide ? "hide-legacy" : "archive-legacy",
      Number(receipt.before.version),
      receipt.identity !== legacyTitles[1],
    );
    receipt.after = await this.driver.snapshot(receipt.fixture.id);
    receipt.auditAfter = await this.driver.audits(receipt.fixture.id);
  }
  async assertState(state: string) {
    expect(this.receipt!.after.state).toBe(state);
  }
  async verify() {
    assertLegacyReceipt(this.receipt!, this.receipt!.identity);
  }
  async excluded() {
    this.receipt!.publicAfter = await this.driver.publicLists();
    this.receipt!.hiddenNotice = await this.driver.hiddenNotice(
      this.receipt!.fixture.slug,
    );
    await this.verify();
  }
}
