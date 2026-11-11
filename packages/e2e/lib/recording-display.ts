import { expect, type Page } from "@playwright/test";

type Row = Record<string, unknown>;
type Kind = "edited" | "raw";
type Source = { kind: Kind; provider: string; embedRef: string };
type Read<T> = { status: number; body: T };
export const displayOutline =
  "The display rule is derived from the published rows alone";
export const singleCutTitle =
  "The secondary affordance is absent when only one kind is published";
export const hiddenRecordingTitle =
  "A hidden event keeps its feature 004 render";
export const displayExamples = [
  {
    published: "edited + raw",
    kinds: ["edited", "raw"],
    state: "montage",
    primary: "edited",
    secondary: "raw",
  },
  {
    published: "edited only",
    kinds: ["edited"],
    state: "montage",
    primary: "edited",
    secondary: null,
  },
  {
    published: "raw only",
    kinds: ["raw"],
    state: "raw-only",
    primary: "raw",
    secondary: null,
  },
  {
    published: "none",
    kinds: [],
    state: "preparing",
    primary: null,
    secondary: null,
  },
] as const;
export type DisplayRow = {
  id: string;
  event_id: string;
  kind: string;
  status: string;
  deleted_at: string | null;
  provider: string;
  embed_ref: string;
};
export type DisplayBrowser = {
  path: string;
  profileStatus: number;
  primarySrc: string | null;
  primaryTitle: string | null;
  frameCount: number;
  plaque: boolean;
  secondaryRendered: boolean;
  secondaryInitiallyOpen: boolean;
  secondaryFramesBefore: number;
  secondaryFramesAfter: number;
  secondarySrc: string | null;
  secondaryTitle: string | null;
  mainDetails: number;
};
export type DisplayList = { query: string; status: number; body: unknown };
export type DisplayReceipt = {
  identity: string;
  example: number | null;
  published: string[];
  fixture: { id: string; slug: string; state: string; version: number };
  rows: DisplayRow[];
  projection: Read<{
    state: string;
    primaryKind: string | null;
    secondaryKind: string | null;
  }>;
  playback: Read<{ primary: Source | null; secondary: Source | null }>;
  browser: DisplayBrowser;
  hidden?: {
    before: Row;
    after: Row;
    answer: Read<Row> & {
      request: {
        method: string;
        path: string;
        ifMatch: string;
        idempotencyKey: string;
      };
    };
    recordingBefore: DisplayRow[];
    recordingAfter: DisplayRow[];
    publicRead: Read<Row>;
    beforeLists: DisplayList[];
    afterLists: DisplayList[];
    browser: {
      path: string;
      notice: boolean;
      participationControls: number;
      frameCount: number;
      playerCount: number;
      plaqueCount: number;
      sourceLeak: boolean;
    };
  };
};
function source(row: DisplayRow | undefined): Source | null {
  return row
    ? {
        kind: row.kind as Kind,
        provider: row.provider,
        embedRef: row.embed_ref,
      }
    : null;
}
function src(value: Source | null) {
  return value ? `https://rutube.ru/play/embed/${value.embedRef}` : null;
}
// 014 EARS-3/4/8: literal source Examples and real UI receipts, independent of the resolver.
export function assertDisplayReceipt(
  r: DisplayReceipt,
  identity: string,
  example: number | null,
) {
  expect(r).toBeDefined();
  expect(r.identity).toBe(identity);
  expect(r.example).toBe(example);
  expect(r.fixture.id).toBeTruthy();
  expect(r.fixture.slug).toBeTruthy();
  expect(r.fixture.state).toBe("ended");
  const c =
    identity === displayOutline
      ? displayExamples[example! - 1]
      : displayExamples[1];
  expect(c).toBeDefined();
  expect(r.published).toEqual(c!.kinds);
  expect(
    r.rows
      .filter((row) => row.status === "published" && row.deleted_at === null)
      .map((row) => row.kind)
      .sort(),
  ).toEqual([...c!.kinds].sort());
  if (c!.secondary)
    expect(new Set(r.rows.map((row) => row.embed_ref)).size).toBe(
      r.rows.length,
    );
  for (const row of r.rows) {
    expect(row.event_id).toBe(r.fixture.id);
    expect(row.provider).toBe("rutube");
    expect(row.embed_ref).toMatch(/^[0-9a-f]{32}$/);
  }
  if (identity === hiddenRecordingTitle) {
    assertHidden(r);
    return;
  }
  expect([displayOutline, singleCutTitle]).toContain(identity);
  expect(r.projection.status).toBe(200);
  expect(r.projection.body).toMatchObject({
    state: c!.state,
    primaryKind: c!.primary,
    secondaryKind: c!.secondary,
  });
  expect(r.playback.status).toBe(200);
  const primary = source(
    r.rows.find(
      (row) =>
        row.kind === c!.primary &&
        row.status === "published" &&
        row.deleted_at === null,
    ),
  );
  const secondary = source(
    r.rows.find(
      (row) =>
        row.kind === c!.secondary &&
        row.status === "published" &&
        row.deleted_at === null,
    ),
  );
  if (primary) expect(r.playback.body.primary).toMatchObject(primary);
  else expect(r.playback.body.primary).toBeNull();
  expect(r.playback.body.secondary).toEqual(
    secondary ? expect.objectContaining(secondary) : null,
  );
  const b = r.browser;
  expect(b.path).toBe(`/webinars/${r.fixture.slug}`);
  expect(b.profileStatus).toBe(200);
  expect(b.primarySrc).toBe(src(primary));
  expect(b.frameCount).toBe(primary ? 1 : 0);
  expect(b.plaque).toBe(primary === null);
  if (primary)
    expect(b.primaryTitle).toContain(
      primary.kind === "edited" ? "Монтаж" : "Оригинал",
    );
  else expect(b.primaryTitle).toBeNull();
  expect(b.secondaryRendered).toBe(secondary !== null);
  expect(b.secondaryInitiallyOpen).toBe(false);
  expect(b.secondaryFramesBefore).toBe(0);
  expect(b.secondaryFramesAfter).toBe(secondary ? 1 : 0);
  expect(b.secondarySrc).toBe(src(secondary));
  expect(b.mainDetails).toBe(secondary ? 1 : 0);
  if (secondary) expect(b.secondaryTitle).toContain("Оригинал");
  else expect(b.secondaryTitle).toBeNull();
}
function assertHidden(r: DisplayReceipt) {
  const h = r.hidden!;
  expect(h).toBeDefined();
  expect(h.before).toMatchObject({ id: r.fixture.id, state: "ended" });
  expect(h.after).toMatchObject({
    id: r.fixture.id,
    state: "hidden",
    version: Number(h.before.version) + 1,
  });
  expect(h.answer.status).toBe(200);
  expect(h.answer.body.state).toBe("hidden");
  expect(h.answer.request).toMatchObject({
    method: "POST",
    path: `/v1/admin/events/${r.fixture.id}/hide`,
    ifMatch: `W/"${h.before.version}"`,
  });
  expect(h.answer.request.idempotencyKey).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  expect(h.recordingBefore).toEqual(r.rows);
  expect(h.recordingAfter).toEqual(h.recordingBefore);
  expect(h.publicRead.status).toBe(200);
  expect(h.publicRead.body.state).toBe("hidden");
  expect(h.browser).toEqual({
    path: `/webinars/${r.fixture.slug}`,
    notice: true,
    participationControls: 0,
    frameCount: 0,
    playerCount: 0,
    plaqueCount: 0,
    sourceLeak: false,
  });
  const queries = [
    "timeframe=upcoming",
    "timeframe=past",
    "",
    "me:upcoming",
    "me:recordings",
  ];
  expect(h.beforeLists.map((l) => l.query)).toEqual(queries);
  expect(h.afterLists.map((l) => l.query)).toEqual(queries);
  for (let i = 0; i < queries.length; i++) {
    const before = h.beforeLists[i]!,
      after = h.afterLists[i]!;
    expect(before.status).toBe(200);
    expect(after.status).toBe(200);
    expect(JSON.stringify(after.body)).not.toContain(r.fixture.id);
    expect(JSON.stringify(after.body)).not.toContain(r.fixture.slug);
    if (i === 2) {
      expect(Array.isArray(before.body)).toBe(true);
      expect(Array.isArray(after.body)).toBe(true);
      continue;
    }
    const pre = before.body as {
        data: unknown[];
        counts: Record<string, number>;
      },
      post = after.body as typeof pre;
    if (i === 1 || i === 4)
      expect(JSON.stringify(pre.data)).toContain(r.fixture.id);
    const key = i < 3 ? "past" : "recordings";
    expect(pre.counts[key]).toBeGreaterThan(0);
    expect(post.counts[key]).toBe(pre.counts[key]! - 1);
    expect(post.counts.upcoming).toBe(pre.counts.upcoming);
  }
}

export async function collectDisplayBrowser(
  page: Page,
  path: string,
  hasPrimary: boolean,
  hasSecondary: boolean,
): Promise<DisplayBrowser> {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("player-card")).toBeVisible();
  const profileStatus = await page.evaluate(
    async () => (await fetch("/v1/me/profile")).status,
  );
  expect(profileStatus).toBe(200);
  const main = page.getByTestId("recording-player").first().locator("iframe");
  if (hasPrimary) {
    await expect(main).toHaveCount(1);
    await expect(page.getByTestId("recording-plaque")).toHaveCount(0);
  } else {
    await expect(page.getByTestId("recording-plaque")).toBeVisible();
    await expect(page.locator("main iframe")).toHaveCount(0);
  }
  const primarySrc = hasPrimary ? await main.getAttribute("src") : null,
    primaryTitle = hasPrimary ? await main.getAttribute("title") : null;
  const frameCount = await page.locator("main iframe").count();
  const spoiler = page.getByTestId("recording-spoiler");
  let secondaryInitiallyOpen = false,
    secondaryFramesBefore = 0,
    secondarySrc: string | null = null,
    secondaryTitle: string | null = null,
    secondaryFramesAfter = 0;
  if (hasSecondary) {
    await expect(spoiler).toBeVisible();
    await expect(spoiler).toContainText("Смотреть оригинал трансляции");
    secondaryInitiallyOpen = await spoiler.evaluate(
      (el: HTMLDetailsElement) => el.open,
    );
    secondaryFramesBefore = await spoiler.locator("iframe").count();
    await spoiler.locator("summary").click();
    await expect(spoiler.locator("iframe")).toHaveCount(1);
    secondaryFramesAfter = await spoiler.locator("iframe").count();
    secondarySrc = await spoiler.locator("iframe").getAttribute("src");
    secondaryTitle = await spoiler.locator("iframe").getAttribute("title");
  } else await expect(spoiler).toHaveCount(0);
  return {
    path,
    profileStatus,
    primarySrc,
    primaryTitle,
    frameCount,
    plaque: (await page.getByTestId("recording-plaque").count()) === 1,
    secondaryRendered: (await spoiler.count()) === 1,
    secondaryInitiallyOpen,
    secondaryFramesBefore,
    secondaryFramesAfter,
    secondarySrc,
    secondaryTitle,
    mainDetails: await page.locator("main details").count(),
  };
}

export interface RecordingDisplayDriver {
  fixture(kinds: readonly string[]): Promise<DisplayReceipt["fixture"]>;
  rows(id: string): Promise<DisplayRow[]>;
  projection(slug: string): Promise<DisplayReceipt["projection"]>;
  playback(slug: string): Promise<DisplayReceipt["playback"]>;
  browser(
    path: string,
    primary: boolean,
    secondary: boolean,
  ): Promise<DisplayBrowser>;
  hide(
    fixture: DisplayReceipt["fixture"],
  ): Promise<NonNullable<DisplayReceipt["hidden"]>>;
  hiddenBrowser(
    fixture: DisplayReceipt["fixture"],
    rows: DisplayRow[],
  ): Promise<NonNullable<DisplayReceipt["hidden"]>["browser"]>;
}
export class RecordingDisplayProof {
  receipt?: DisplayReceipt;
  constructor(private readonly driver: RecordingDisplayDriver) {}
  async prepare(published: string, identity = displayOutline) {
    const index = displayExamples.findIndex((c) => c.published === published);
    expect(index).toBeGreaterThanOrEqual(0);
    const c = displayExamples[index]!,
      fixture = await this.driver.fixture(c.kinds);
    this.receipt = {
      identity,
      example: identity === displayOutline ? index + 1 : null,
      published: [...c.kinds],
      fixture,
      rows: await this.driver.rows(fixture.id),
      projection: undefined as unknown as DisplayReceipt["projection"],
      playback: undefined as unknown as DisplayReceipt["playback"],
      browser: undefined as unknown as DisplayBrowser,
    };
    if (identity === hiddenRecordingTitle)
      this.receipt.hidden = await this.driver.hide(fixture);
  }
  async read() {
    const r = this.receipt!,
      c =
        r.identity === displayOutline
          ? displayExamples[r.example! - 1]!
          : displayExamples[1];
    r.projection = await this.driver.projection(r.fixture.slug);
    r.playback = await this.driver.playback(r.fixture.slug);
    r.browser = await this.driver.browser(
      `/webinars/${r.fixture.slug}`,
      c.primary !== null,
      c.secondary !== null,
    );
  }
  async readHidden() {
    const r = this.receipt!;
    r.hidden!.browser = await this.driver.hiddenBrowser(r.fixture, r.rows);
  }
  verify() {
    const r = this.receipt!;
    assertDisplayReceipt(r, r.identity, r.example);
  }
}
