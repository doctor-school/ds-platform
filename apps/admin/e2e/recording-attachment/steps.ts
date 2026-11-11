import { randomUUID, createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile } from "node:fs/promises";
import {
  readBackfillOutput,
  backfillTitles,
  assertBackfillReceipt,
  type BackfillReceipt,
} from "../../../../packages/e2e/lib/recording-backfill";
import { bootstrapAdminSession, signInAsAdmin } from "@ds/e2e/admin-events";
import { expect, type Page, type APIRequestContext } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { Pool, type QueryResultRow } from "pg";
import { adminOrigin, test } from "../support/fixtures";

import {
  LegacyTransitionProof,
  assertBoundaryReceipt,
  boundaryCases,
  noDeleteTitle,
  type BoundaryReceipt,
  legacyTitles,
  type LegacyAnswer,
  type PublicLists,
  type PublicListBody,
} from "../../../../packages/e2e/lib/legacy-transition";

import { RecordingLifecycleProof } from "../../../../packages/e2e/lib/recording-lifecycle";

const { Given, When, Then, Before, After } = createBdd(test);
type Recording = {
  id: string;
  kind: string;
  version: number;
  status: string;
  deletedAt: string | null;
};
type Event = { id: string; slug: string };
type Answer = {
  status: number;
  body: Recording & { errorCode?: string; [key: string]: unknown };
  etag: string | null;
  location: string | null;
  request: LegacyAnswer["request"];
};
type State = {
  backfill?: Partial<BackfillReceipt>;
  backfillTitle?: string;
  backfillTargets?: Event[];
  boundary?: BoundaryReceipt;
  boundarySelected?: boolean;
  boundaryOrigin?: string;
  caseKind?: string;
  caseState?: string;
  lifecycle?: RecordingLifecycleProof;
  legacy?: LegacyTransitionProof;
  backgrounds: { clause: string; evidence: unknown[] }[];
  events: Event[];
  visitor?: APIRequestContext;
  portal?: Page;
  operator?: { id: string; zitadel_sub: string };
  event?: Event;
  recording?: Recording;
  original?: QueryResultRow[];
  answer?: Answer;
  eventBefore?: QueryResultRow[];
};
const states = new WeakMap<Page, State>();
function state(page: Page) {
  const value = states.get(page);
  if (!value) throw new Error("014 original not started");
  return value;
}
function op(command: string, detail?: unknown) {
  const file = process.env.E2E_RECORDING_ATTACHMENT_LOG;
  if (!file) throw new Error("E2E_RECORDING_ATTACHMENT_LOG required");
  appendFileSync(
    file,
    JSON.stringify({ at: new Date().toISOString(), command, detail }) + "\n",
  );
}
async function sql<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const database = process.env.E2E_RECORDING_ATTACHMENT_DATABASE;
  const url = process.env.DATABASE_URL;
  if (
    !url ||
    !(
      database === "ds_dev_3851" ||
      database === "ds_dev_3929" ||
      database === "ds_dev_3932" ||
      database === "ds_dev_3934" ||
      database === "ds_dev_3939" ||
      (process.env.CI === "true" && database === "ds_admin_e2e")
    ) ||
    new URL(url).pathname !== `/${database}`
  )
    throw new Error("014 requires its explicitly owned database");
  op("SQL", { database, text, values });
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    expect(
      (await pool.query("SELECT current_database() AS name")).rows,
    ).toEqual([{ name: database }]);
    return (await pool.query<T>(text, values)).rows;
  } finally {
    await pool.end();
  }
}
async function api(
  page: Page,
  path: string,
  method = "GET",
  body?: unknown,
  version?: number,
  defect?: "key" | "etag",
): Promise<Answer> {
  op(`${method} ${path}`, { phase: "before" });
  const result = await page.evaluate(
    async ({ path, method, body, version, defect }) => {
      const headers: Record<string, string> = {};
      if (method !== "GET") {
        if (body !== undefined) headers["content-type"] = "application/json";
        if (defect !== "key") headers["idempotency-key"] = crypto.randomUUID();
        const cookie = document.cookie
          .split("; ")
          .find((s) => s.startsWith("__Host-ds_admin_csrf="));
        if (!cookie) throw new Error("Missing real Admin CSRF cookie");
        headers["x-ds-admin-csrf"] = decodeURIComponent(
          cookie.slice(cookie.indexOf("=") + 1),
        );
        if (version !== undefined && defect !== "etag")
          headers["if-match"] = `W/"${version}"`;
      }
      const response = await fetch(path, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return {
        request: {
          method,
          path,
          ifMatch: headers["if-match"] ?? "",
          idempotencyKey: headers["idempotency-key"] ?? "",
          transport: "api",
        },
        status: response.status,
        body: await response.json(),
        etag: response.headers.get("etag"),
        location: response.headers.get("location"),
      };
    },
    { path, method, body, version, defect },
  );
  op(`${method} ${path}`, { status: result.status, etag: result.etag });
  return result;
}
const payload = (kind: string) => ({
  kind,
  provider: "rutube",
  embedRef: "0123456789abcdef0123456789abcdef",
});
const path = (event: Event) => `/v1/admin/events/${event.id}/recordings`;
async function attach(page: Page, event: Event, kind: string) {
  const response = await api(page, path(event), "POST", payload(kind));
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  expect(response.etag).toBe('W/"1"');
  expect(response.location).toBe(`${path(event)}/${response.body.id}`);
  return response.body;
}
async function command(
  page: Page,
  event: Event,
  row: Recording,
  action: string,
) {
  const response = await api(
    page,
    `${path(event)}/${row.id}/${action}`,
    "POST",
    undefined,
    row.version,
  );
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body;
}
async function event(page: Page, lifecycle = "ended"): Promise<Event> {
  const id = randomUUID(),
    slug = `recording-${process.env.E2E_RECORDING_ATTACHMENT_DATABASE}-${id}`;
  state(page).events.push({ id, slug });
  await sql(
    "INSERT INTO events (id,slug,title,school,starts_at,duration_min,state,kind_id,audience) VALUES ($1,$2,'Проверка записи 3851','Кардиология',now()-interval '2 days',60,$3,(SELECT id FROM event_kinds WHERE status='published' AND 'online'=ANY(allowed_formats) LIMIT 1),'experts')",
    [id, slug, lifecycle],
  );
  return { id, slug };
}
async function publicEvent(page: Page, event: Event) {
  const response = await state(page).visitor!.get(
    `/v1/public/events/${event.slug}`,
  );
  op(`anonymous GET /v1/public/events/${event.slug}`, {
    status: response.status(),
  });
  expect(response.status()).toBe(200);
  return response.json();
}
function receipt(page: Page, clause: string, ...evidence: unknown[]) {
  state(page).backgrounds.push({ clause, evidence });
}
Before(async ({ page, browser, playwright, $tags, $testInfo }) => {
  expect($tags).toContain("@host:academy");
  const origin = process.env.E2E_RECORDING_ATTACHMENT_PORTAL_URL;
  if (!origin) throw new Error("Dedicated Academy portal URL required");
  states.set(page, {
    backgrounds: [],
    events: [],
    boundarySelected: $tags.includes("@recording-command-boundaries"),
  });
  const visitor = await playwright.request.newContext({ baseURL: origin });
  state(page).visitor = visitor;
  state(page).portal = await browser.newPage({ baseURL: origin });
  op("provision exact owned Admin actor", { origin: adminOrigin() });
  const credentials = await bootstrapAdminSession(adminOrigin());
  op("owned account", { email: credentials.email });
  const actors = await sql<{ id: string; zitadel_sub: string }>(
    "SELECT id,zitadel_sub FROM users WHERE email=$1",
    [credentials.email],
  );
  expect(actors).toHaveLength(1);
  state(page).operator = actors[0];
  await signInAsAdmin(page, credentials);
  $testInfo.annotations.push({ type: "source-host", description: "academy" });
});
Given(
  "a finished event means EventLifecycleState is ended and nothing else",
  async ({ page }) => {
    const evidence = [];
    for (const lifecycle of ["draft", "published", "live", "ended", "hidden"]) {
      const control = await event(page, lifecycle);
      const row = await attach(page, control, "raw");
      const response = await api(
        page,
        `${path(control)}/${row.id}/publish`,
        "POST",
        undefined,
        row.version,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(
        lifecycle === "ended" ? 200 : 409,
      );
      if (lifecycle !== "ended")
        expect(response.body.errorCode).toBe("EVENT_NOT_FINISHED");
      evidence.push({ id: control.id, lifecycle, status: response.status });
    }
    receipt(page, "ended-only", ...evidence);
  },
);
Given(
  "a hidden event keeps the feature 004 notice and appears in no 014 listing, tab or count",
  async ({ page }) => {
    const control = await event(page);
    await command(page, control, await attach(page, control, "raw"), "publish");
    const readLists = async () => {
      const result = [];
      for (const query of ["timeframe=past", "timeframe=upcoming"]) {
        const response = await state(page).visitor!.get(
          `/v1/public/events?${query}`,
        );
        expect(response.status()).toBe(200);
        result.push(await response.json());
      }
      return result;
    };
    const before = await readLists();
    expect(JSON.stringify(before[0])).toContain(control.id);
    await sql("UPDATE events SET state='hidden' WHERE id=$1", [control.id]);
    const hidden = await publicEvent(page, control);
    expect(hidden.state).toBe("hidden");
    const after = await readLists();
    for (const body of after)
      expect(JSON.stringify(body)).not.toContain(control.id);
    for (let i = 0; i < after.length; i++) {
      expect(after[i].counts.past).toBe(before[i].counts.past - 1);
      expect(after[i].counts.upcoming).toBe(before[i].counts.upcoming);
    }
    const portal = state(page).portal!;
    await portal.goto(`/webinars/${control.slug}`);
    await expect(portal.getByText("Скрыто", { exact: true })).toBeVisible();
    await expect(
      portal.getByText(
        "Мероприятие скрыто — участие в нём больше не предлагается",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(portal.getByTestId("recording-plaque")).toHaveCount(0);
    receipt(page, "hidden-exclusion", {
      id: control.id,
      before,
      after,
      hidden,
    });
  },
);
Given(
  "every recording mutation carries a canonical Idempotency-Key and every non-create mutation carries the target ETag",
  async ({ page }) => {
    const control = await event(page);
    const keyless = await api(
      page,
      path(control),
      "POST",
      payload("raw"),
      undefined,
      "key",
    );
    expect(keyless.status).toBe(428);
    expect(keyless.body.errorCode).toBe("IDEMPOTENCY_KEY_REQUIRED");
    const row = await attach(page, control, "raw");
    const before = await sql("SELECT * FROM event_recordings WHERE id=$1", [
      row.id,
    ]);
    const target = `${path(control)}/${row.id}/retire`;
    const etagless = await api(
      page,
      target,
      "POST",
      undefined,
      row.version,
      "etag",
    );
    expect(etagless.status).toBe(428);
    expect(etagless.body.errorCode).toBe("PRECONDITION_REQUIRED");
    const stale = await api(page, target, "POST", undefined, 0);
    expect(stale.status).toBe(412);
    expect(
      await sql("SELECT * FROM event_recordings WHERE id=$1", [row.id]),
    ).toEqual(before);
    const retired = await command(page, control, row, "retire");
    expect(retired.status).toBe("retired");
    receipt(page, "mutation-protocol", {
      id: row.id,
      keyless: keyless.status,
      create: 201,
      etagless: etagless.status,
      stale: stale.status,
      retire: 200,
    });
  },
);
Given(
  "event_recordings rows are retained with restrictive foreign keys and no Delete route",
  async ({ page }) => {
    const control = await event(page);
    const row = await attach(page, control, "raw");
    const foreignKeys = await sql<{ confdeltype: string }>(
      "SELECT confdeltype FROM pg_constraint WHERE conrelid='event_recordings'::regclass AND contype='f'",
    );
    expect(foreignKeys.length).toBeGreaterThan(0);
    for (const fk of foreignKeys) expect(["r", "a"]).toContain(fk.confdeltype);
    const response = await api(
      page,
      `${path(control)}/${row.id}`,
      "DELETE",
      undefined,
      row.version,
    );
    expect(response.status).toBe(404);
    const retired = await command(page, control, row, "retire");
    const retained = await sql(
      "SELECT id,deleted_at FROM event_recordings WHERE id=$1",
      [row.id],
    );
    expect(retained).toHaveLength(1);
    expect(retained[0]!.deleted_at).not.toBeNull();
    const list = await api(page, `${path(control)}?includeRetired=true`);
    expect(JSON.stringify(list.body)).toContain(retired.id);
    receipt(page, "retention", {
      id: row.id,
      foreignKeys,
      deleteStatus: response.status,
      retained,
    });
  },
);
Given(
  "the display rule is derived at read time from published non-retired recordings only",
  async ({ page }) => {
    const control = await event(page);
    const raw = await attach(page, control, "raw");
    expect((await publicEvent(page, control)).recording.state).toBe(
      "preparing",
    );
    const publishedRaw = await command(page, control, raw, "publish");
    expect((await publicEvent(page, control)).recording).toMatchObject({
      state: "raw-only",
      primaryKind: "raw",
    });
    const edited = await command(
      page,
      control,
      await attach(page, control, "edited"),
      "publish",
    );
    expect((await publicEvent(page, control)).recording).toMatchObject({
      state: "montage",
      primaryKind: "edited",
      secondaryKind: "raw",
    });
    await command(page, control, edited, "retire");
    expect((await publicEvent(page, control)).recording.state).toBe("raw-only");
    await command(page, control, publishedRaw, "unpublish");
    expect((await publicEvent(page, control)).recording.state).toBe(
      "preparing",
    );
    receipt(page, "derived-display", {
      id: control.id,
      states: ["preparing", "raw-only", "montage", "raw-only", "preparing"],
    });
  },
);
Given(
  "Stage A uses vendored canvases for portal composition and the approved Refine decisions plus design-system blocks for admin composition",
  async ({ page }) => {
    const root = resolve(process.cwd(), "../..");
    const manifest = JSON.parse(
      readFileSync(resolve(root, "design-source/manifest.json"), "utf8"),
    ) as { files: Record<string, { sha256: string }> };
    const paths = [
      "design-source/event-page.dc.html",
      "design-source/unit-events-filter.dc.html",
      "design-source/account-my-events.dc.html",
    ];
    const sources = paths.map((path) => {
      const bytes = readFileSync(resolve(root, path));
      expect(bytes.length).toBeGreaterThan(100);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      expect(sha256).toBe(
        manifest.files[path.replace("design-source/", "")]!.sha256,
      );
      return { path, sha256 };
    });
    const design = readFileSync(
      resolve(
        root,
        "apps/docs/content/specs/features/014-event-recordings/014-design.md",
      ),
      "utf8",
    );
    expect(design).toContain("#1282/#1337 tabbed Refine decisions plus #1578");
    expect(design).toContain("#1605");
    receipt(page, "approved-composition", ...sources, {
      approvals: [1282, 1337, 1578, 1605],
    });
  },
);
Given(
  "a finished event with no recording of kind {word}",
  async ({ page }, kind: string) => {
    const value = state(page);
    value.caseKind = kind;
    value.event = await event(page);
    expect(
      await sql(
        "SELECT id FROM event_recordings WHERE event_id=$1 AND kind=$2",
        [value.event.id, kind],
      ),
    ).toEqual([]);
    value.eventBefore = await sql("SELECT * FROM events WHERE id=$1", [
      value.event.id,
    ]);
  },
);
When(
  "the operator attaches a {word} recording with a playable source",
  async ({ page }, kind: string) => {
    state(page).recording = await attach(page, state(page).event!, kind);
  },
);
Then(
  "one retained event_recordings row exists with that kind, version 1 and status draft",
  async ({ page }) => {
    const value = state(page);
    expect(
      await sql(
        "SELECT id,kind,version,status,deleted_at FROM event_recordings WHERE event_id=$1",
        [value.event!.id],
      ),
    ).toEqual([
      {
        id: value.recording!.id,
        kind: value.recording!.kind,
        version: 1,
        status: "draft",
        deleted_at: null,
      },
    ]);
  },
);
Then(
  "the public event page still shows the «запись готовится» plaque",
  async ({ page }) => {
    const value = state(page);
    expect((await publicEvent(page, value.event!)).recording.state).toBe(
      "preparing",
    );
    await value.portal!.goto(`/webinars/${value.event!.slug}`);
    await expect(value.portal!.getByTestId("recording-plaque")).toBeVisible();
    await expect(value.portal!.getByTestId("recording-plaque")).toContainText(
      "Запись готовится",
    );
  },
);
Then("no URL column was written on the event row", async ({ page }) => {
  const value = state(page);
  expect(
    await sql("SELECT * FROM events WHERE id=$1", [value.event!.id]),
  ).toEqual(value.eventBefore);
});
Given("a finished event with a published raw recording", async ({ page }) => {
  const value = state(page);
  value.event = await event(page);
  value.recording = await command(
    page,
    value.event,
    await attach(page, value.event, "raw"),
    "publish",
  );
  value.original = await sql("SELECT * FROM event_recordings WHERE id=$1", [
    value.recording.id,
  ]);
});
When("the operator attaches another raw recording", async ({ page }) => {
  state(page).answer = await api(
    page,
    path(state(page).event!),
    "POST",
    payload("raw"),
  );
});
Then(
  "the request fails with 409 RECORDING_KIND_OCCUPIED naming the existing row",
  async ({ page }) => {
    const value = state(page);
    expect(value.answer!.status).toBe(409);
    expect(value.answer!.body.errorCode).toBe("RECORDING_KIND_OCCUPIED");
    expect(JSON.stringify(value.answer!.body)).toContain(value.recording!.id);
  },
);
Then("no second raw row is created", async ({ page }) => {
  const value = state(page);
  expect(
    await sql(
      "SELECT * FROM event_recordings WHERE event_id=$1 AND kind='raw'",
      [value.event!.id],
    ),
  ).toEqual(value.original);
});
Given("a finished event with a draft raw recording", async ({ page }) => {
  const value = state(page);
  value.event = await event(page);
  value.recording = await attach(page, value.event, "raw");
});
When("the operator retires that recording", async ({ page }) => {
  const value = state(page);
  value.recording = await command(
    page,
    value.event!,
    value.recording!,
    "retire",
  );
});
When("attaches a new raw recording", async ({ page }) => {
  state(page).answer = {
    status: 201,
    body: await attach(page, state(page).event!, "raw"),
    etag: 'W/"1"',
    location: null,
    request: {
      method: "POST",
      path: path(state(page).event!),
      ifMatch: "",
      idempotencyKey: "",
      transport: "api",
    },
  };
});
Then(
  "the retired row is still addressable with deleted_at set",
  async ({ page }) => {
    const value = state(page);
    const retained = await sql(
      "SELECT id,deleted_at FROM event_recordings WHERE id=$1",
      [value.recording!.id],
    );
    expect(retained).toHaveLength(1);
    expect(retained[0]!.deleted_at).not.toBeNull();
    expect(
      JSON.stringify(
        (await api(page, `${path(value.event!)}?includeRetired=true`)).body,
      ),
    ).toContain(value.recording!.id);
  },
);
Then("the new raw row is created in draft", async ({ page }) => {
  const value = state(page);
  expect(value.answer!.body).toMatchObject({
    kind: "raw",
    status: "draft",
    version: 1,
    deletedAt: null,
  });
  expect(value.answer!.body.id).not.toBe(value.recording!.id);
  expect(
    await sql(
      "SELECT id FROM event_recordings WHERE event_id=$1 AND kind='raw'",
      [value.event!.id],
    ),
  ).toHaveLength(2);
});
function lifecycle(page: Page) {
  const value = state(page);
  return (value.lifecycle ??= new RecordingLifecycleProof({
    event: (status) => event(page, status),
    attach: (target, kind) => attach(page, target, kind),
    command: (target, row, action) => command(page, target, row, action),
    publish: (target, row) =>
      api(
        page,
        `${path(target)}/${row.id}/publish`,
        "POST",
        undefined,
        row.version,
      ),
    sql,
    actor: () => value.operator!.zitadel_sub,
  }));
}
Given("a finished event with a draft edited recording", async ({ page }) => {
  await lifecycle(page).draft();
});
When("the operator publishes it", async ({ page }) => {
  await lifecycle(page).publish();
});
Then("first_published_at is set once on that row", async ({ page }) => {
  await lifecycle(page).timestamp();
});
Then("the event's own lifecycle state is unchanged", async ({ page }) => {
  await lifecycle(page).unchangedEvent();
});
When("the operator unpublishes it and publishes it again", async ({ page }) => {
  await lifecycle(page).republish();
});
Then("first_published_at still holds its original value", async ({ page }) => {
  await lifecycle(page).originalTimestamp();
});
Given("an event in state {word}", async ({ page }, status: string) => {
  state(page).caseState = status;
});
Given("a draft edited recording attached to it", async ({ page }) => {
  await lifecycle(page).draft(state(page).caseState);
});
When("the operator publishes that recording", async ({ page }) => {
  await lifecycle(page).attemptPublish();
});
Then("the request fails with 409 EVENT_NOT_FINISHED", async ({ page }) => {
  if (state(page).legacy) await legacy(page).verify();
  else await lifecycle(page).rejected();
});
Then("the recording is still draft", async ({ page }) => {
  await lifecycle(page).unchangedDraft();
});
Given("the generic audit capture of feature 010", async ({ page }) => {
  await lifecycle(page).genericAudit();
});
When(
  "a recording is attached, published, unpublished, retired or restored",
  async ({ page }) => {
    await lifecycle(page).auditedMutations();
  },
);
Then(
  "one attributed audit row is appended per committed mutation",
  async ({ page }) => {
    await lifecycle(page).auditCount();
  },
);
Then("no 014-specific audit table was introduced", async ({ page }) => {
  await lifecycle(page).noSpecificAuditTable();
});
function legacy(page: Page) {
  const value = state(page);
  return (value.legacy ??= new LegacyTransitionProof({
    actor: () => value.operator!.zitadel_sub,
    snapshot: async (id) =>
      (
        await sql("SELECT to_jsonb(e) AS row FROM events e WHERE id=$1", [id])
      )[0]!.row,
    audits: (id) =>
      sql(
        "SELECT id,event_type,subject_id,metadata FROM audit_ledger WHERE metadata->>'aggregateId'=$1 OR (metadata->>'table'='events' AND metadata->'pk'->>'id'=$1) ORDER BY id",
        [id],
      ),
    create: async (published) => {
      const lists = await legacyLists(page);
      const horizonToday = (lists[0]!.body as PublicListBody).horizon.today;
      expect(horizonToday).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const day = new Date(
        Date.parse(`${horizonToday}T12:00:00Z`) - 2 * 86400000,
      )
        .toISOString()
        .slice(0, 10);
      const heldAtMsk = `${day}T12:00`;
      const kinds = await sql(
        "SELECT id FROM event_kinds WHERE status='published' AND 'online'=ANY(allowed_formats) LIMIT 1",
      );
      expect(kinds).toHaveLength(1);
      const created = await api(page, "/v1/admin/legacy-broadcasts", "POST", {
        title: `Legacy broadcast 3932 ${randomUUID()}`,
        heldAtMsk,
        durationMin: 60,
        kindId: kinds[0]!.id,
        participationFormat: "online",
        audience: "experts",
        recording: payload("edited"),
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const target = { id: created.body.id, slug: String(created.body.slug) };
      value.events.push(target);
      expect(created.body).toMatchObject({
        origin: "legacy",
        state: "hidden",
        audience: "experts",
      });
      const rows = await sql(
        "SELECT id,kind,version,status,deleted_at FROM event_recordings WHERE event_id=$1",
        [target.id],
      );
      expect(rows).toHaveLength(1);
      let recording = {
        ...rows[0],
        deletedAt: rows[0]!.deleted_at,
      } as Recording;
      if (published)
        recording = await command(page, target, recording, "publish");
      return {
        ...target,
        heldAtMsk,
        horizonToday,
        audience: "experts",
        recording,
      };
    },
    transition: async (id, action, version, click) => {
      const endpoint = `/v1/admin/events/${id}/${action}`;
      if (!click) return api(page, endpoint, "POST", undefined, version);
      await page.goto(`/events/${id}`);
      await expect(page.getByTestId(`action-${action}`)).toBeVisible();
      const pending = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === endpoint &&
          response.request().method() === "POST",
      );
      op(`Admin click action-${action}`, { id, version });
      await page.getByTestId(`action-${action}`).click();
      const response = await pending;
      const headers = await response.request().allHeaders();
      const answer = {
        status: response.status(),
        body: await response.json(),
        request: {
          method: response.request().method(),
          path: new URL(response.url()).pathname,
          ifMatch: headers["if-match"] ?? "",
          idempotencyKey: headers["idempotency-key"] ?? "",
          transport: "admin-click",
        },
      };
      op(`Admin result ${action}`, answer);
      expect(answer.status).toBe(200);
      await expect(
        page.getByTestId(
          `state-${action === "archive-legacy" ? "in_archive" : "hidden"}`,
        ),
      ).toBeVisible();
      return answer;
    },
    absentAction: async (id) => {
      const detail = await api(page, `/v1/admin/events/${id}`);
      expect(detail.body.validTransitions).toEqual([]);
      await page.goto(`/events/${id}`);
      await expect(page.getByTestId("state-hidden")).toBeVisible();
      await expect(page.getByTestId("action-archive-legacy")).toHaveCount(0);
      return true;
    },
    publicLists: () => legacyLists(page),
    hiddenNotice: async (slug) => {
      await value.portal!.goto(`/webinars/${slug}`);
      await expect(
        value.portal!.getByText("Скрыто", { exact: true }),
      ).toBeVisible();
      await expect(
        value.portal!.getByText(
          "Мероприятие скрыто — участие в нём больше не предлагается",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(value.portal!.getByTestId("recording-plaque")).toHaveCount(
        0,
      );
      return true;
    },
  }));
}
async function legacyLists(page: Page): Promise<PublicLists> {
  const lists: PublicLists = [];
  for (const query of ["timeframe=upcoming", "timeframe=past", ""]) {
    op(`anonymous GET /v1/public/events?${query}`);
    const response = await state(page).visitor!.get(
      `/v1/public/events${query ? `?${query}` : ""}`,
    );
    expect(response.status()).toBe(200);
    lists.push({ query, body: await response.json() });
  }
  return lists;
}
Given(
  "a hidden legacy event carrying a published non-retired recording",
  async ({ page }) => {
    await legacy(page).prepare(legacyTitles[0]);
  },
);
Given(
  "a hidden legacy event whose only recording is still draft",
  async ({ page }) => {
    await legacy(page).prepare(legacyTitles[1]);
  },
);
Given("a legacy event in state {word}", async ({ page }, status: string) => {
  if (!state(page).boundarySelected) {
    await legacy(page).prepare(legacyTitles[2]);
    return;
  }
  state(page).boundaryOrigin = "legacy";
  state(page).caseState = status;
  await legacy(page).prepare(
    status === "in_archive" ? legacyTitles[2] : legacyTitles[0],
  );
  state(page).event = legacy(page).receipt!.fixture;
});
When(
  "the operator invokes «Архивировать» with If-Match and an Idempotency-Key",
  async ({ page }) => {
    await legacy(page).invoke();
  },
);
When("the operator invokes «Архивировать»", async ({ page }) => {
  await legacy(page).invoke();
});
When(
  "the operator invokes «Скрыть» with If-Match and an Idempotency-Key",
  async ({ page }) => {
    await legacy(page).invoke(true);
  },
);
Then("the event state becomes in_archive", async ({ page }) => {
  await legacy(page).assertState("in_archive");
});
Then("the event state becomes hidden", async ({ page }) => {
  await legacy(page).assertState("hidden");
});
Then("the event state is unchanged", async ({ page }) => {
  const boundary = state(page).boundary;
  if (boundary)
    assertBoundaryReceipt(boundary, boundary.outline, boundary.title);
  else await legacy(page).verify();
});
Then("exactly one feature 010 audit row is appended", async ({ page }) => {
  if (legacy(page).receipt!.identity === legacyTitles[2])
    await legacy(page).excluded();
  else await legacy(page).verify();
});
Then("it appears in no listing, tab or count", async ({ page }) => {
  await legacy(page).excluded();
});

async function eventSnapshot(id: string) {
  return (
    await sql("SELECT to_jsonb(e) AS row FROM events e WHERE id=$1", [id])
  )[0]!.row;
}
async function roomSnapshot(id: string) {
  return {
    stream: await sql("SELECT * FROM stream_config WHERE event_id=$1", [id]),
    presence: await sql("SELECT * FROM presence_beats WHERE event_id=$1", [id]),
    liveAt: (await eventSnapshot(id)).live_at,
  };
}
Given("a platform event in state {word}", async ({ page }, status: string) => {
  const value = state(page);
  value.boundaryOrigin = "platform";
  value.caseState = status;
  value.event = await event(page, status);
});
When(
  /^the operator invokes (PublishEvent|OpenRoom|CloseRoom|HideEvent|ConfigureStream|ArchiveLegacyBroadcast|HideLegacyBroadcast)$/,
  async ({ page }, commandName: string) => {
    const value = state(page),
      target = value.event!;
    const definition = boundaryCases.find(
      (c) =>
        c.command === commandName &&
        c.origin === value.boundaryOrigin &&
        c.state === value.caseState,
    )!;
    expect(definition).toBeDefined();
    const before = await eventSnapshot(target.id),
      sideEffectsBefore = await roomSnapshot(target.id);
    const answer = await api(
      page,
      `/v1/admin/events/${target.id}/${definition.route}`,
      definition.method,
      commandName === "ConfigureStream"
        ? { provider: "rutube", embedRef: payload("raw").embedRef }
        : undefined,
      Number(before.version),
    );
    value.boundary = {
      ...definition,
      eventId: target.id,
      before,
      after: await eventSnapshot(target.id),
      answer,
      sideEffectsBefore,
      sideEffectsAfter: await roomSnapshot(target.id),
    };
  },
);
Then("the request fails with 409 INVALID_TRANSITION", async ({ page }) => {
  const r = state(page).boundary!;
  expect(r.answer.status).toBe(409);
  expect(r.answer.body.errorCode ?? r.answer.body.code).toBe(
    "INVALID_TRANSITION",
  );
});
Then(
  "no room record, presence window or stream config is created",
  async ({ page }) => {
    const r = state(page).boundary!;
    assertBoundaryReceipt(r, r.outline, r.title);
  },
);
Given(
  "a finished event with a published edited recording",
  async ({ page }) => {
    const value = state(page);
    value.event = await event(page);
    value.recording = await command(
      page,
      value.event,
      await attach(page, value.event, "edited"),
      "publish",
    );
    const before = await eventSnapshot(value.event.id);
    value.boundary = {
      ...boundaryCases[0]!,
      eventId: value.event.id,
      before,
      after: before,
      answer: undefined as unknown as LegacyAnswer,
      recordingBefore: (
        await sql(
          "SELECT to_jsonb(r) AS row FROM event_recordings r WHERE id=$1",
          [value.recording.id],
        )
      )[0]!.row,
    };
  },
);
When(
  "the operator inspects every action in the recordings panel",
  async ({ page }) => {
    const value = state(page),
      r = value.boundary!;
    await page.goto(`/events/${value.event!.id}`);
    await page.getByTestId("tab-recordings").click();
    const panel = page.getByTestId("recordings-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("recording-status-edited")).toContainText(
      "Опубликована",
    );
    r.panelControls = await panel
      .locator('button:visible,a:visible,[role="menuitem"]:visible')
      .allTextContents();
    const triggers = await panel
      .locator('button[data-testid^="recording-"]:visible')
      .evaluateAll((nodes) =>
        nodes
          .map((n) => n.getAttribute("data-testid")!)
          .filter((id) =>
            /recording-(edit|attach)-|recording-(raw|edited)-(unpublish|retire)/.test(
              id,
            ),
          ),
      );
    expect(triggers.length).toBeGreaterThanOrEqual(4);
    r.dialogs = [];
    for (const id of triggers) {
      await page.getByTestId(id).click();
      const dialog = page.locator(
        '[role="dialog"]:visible,[role="alertdialog"]:visible',
      );
      await expect(dialog).toBeVisible();
      r.dialogs.push(
        id,
        ...(await dialog
          .locator('button:visible,a:visible,[role="menuitem"]:visible')
          .allTextContents()),
      );
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    }
  },
);
Then("no Delete control is present", async ({ page }) => {
  const r = state(page).boundary!;
  expect(r.panelControls!.length).toBeGreaterThan(0);
  for (const label of [...r.panelControls!, ...r.dialogs!])
    expect(label).not.toMatch(/delete|удалить/i);
  await expect(
    page
      .getByTestId("recordings-panel")
      .getByRole("button", { name: /delete|удалить/i }),
  ).toHaveCount(0);
});
Then("no HTTP Delete route exists for a recording", async ({ page }) => {
  const value = state(page),
    r = value.boundary!;
  r.answer = await api(
    page,
    `${path(value.event!)}/${value.recording!.id}`,
    "DELETE",
    undefined,
    value.recording!.version,
  );
  r.after = await eventSnapshot(value.event!.id);
  r.recordingAfter = (
    await sql("SELECT to_jsonb(r) AS row FROM event_recordings r WHERE id=$1", [
      value.recording!.id,
    ])
  )[0]!.row;
  assertBoundaryReceipt(r, "", noDeleteTitle);
});

async function backfillEvent(page: Page, status: string, origin = "platform") {
  const target = await event(page, status);
  await sql(
    "UPDATE events SET origin=$2,live_at=CASE WHEN $3='ended' THEN now()-interval '2 days' ELSE NULL END WHERE id=$1",
    [target.id, origin, status],
  );
  return target;
}
async function backfillSnapshot() {
  return {
    events: (
      await sql("SELECT to_jsonb(e) AS row FROM events e ORDER BY id")
    ).map((r) => r.row),
    recordings: (
      await sql("SELECT to_jsonb(r) AS row FROM event_recordings r ORDER BY id")
    ).map((r) => r.row),
    audit: (
      await sql("SELECT to_jsonb(a) AS row FROM audit_ledger a ORDER BY id")
    ).map((r) => r.row),
  };
}
async function backfillRun(page: Page, dryRun: boolean, setup = false) {
  const value = state(page),
    root = resolve(process.cwd(), "../.."),
    actor = value.operator!.zitadel_sub,
    targets = value.backfillTargets!,
    manifest = targets.map((target) => ({
      event: target.id,
      edited: { provider: "rutube", embed_ref: payload("edited").embedRef },
    }));
  const directory = await mkdtemp(
    resolve(dirname(process.env.E2E_RECORDING_ATTACHMENT_LOG!), "backfill-"),
  );
  const file = resolve(directory, "manifest.json");
  await writeFile(file, JSON.stringify(manifest));
  const args = [
    "--manifest",
    file,
    "--actor",
    actor,
    ...(dryRun ? ["--dry-run"] : []),
  ];
  const entrypoint = "apps/api/scripts/recordings-backfill.ts";
  op("recordings:backfill CLI", {
    entrypoint,
    args,
    database: process.env.E2E_RECORDING_ATTACHMENT_DATABASE,
    setup,
  });
  const before = await backfillSnapshot();
  const result = await promisify(execFile)(
    process.execPath,
    [
      resolve(root, "node_modules/tsx/dist/cli.mjs"),
      resolve(root, entrypoint),
      ...args,
    ],
    {
      cwd: resolve(root, "apps/api"),
      env: process.env,
      timeout: 90_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  const after = await backfillSnapshot();
  await writeFile(resolve(directory, "stdout.jsonl"), result.stdout);
  await writeFile(resolve(directory, "stderr.log"), result.stderr);
  const mapping = await promisify(execFile)(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "const {TAXONOMY_ERROR_STATUS:s}=await import('./dist/taxonomy/taxonomy.errors.js');console.log(JSON.stringify({EVENT_NOT_FINISHED:s.EVENT_NOT_FINISHED,INVALID_TRANSITION:s.INVALID_TRANSITION}))",
    ],
    { cwd: resolve(root, "apps/api"), env: process.env },
  );
  const receipt: BackfillReceipt = {
    title: value.backfillTitle!,
    actor,
    database: process.env.E2E_RECORDING_ATTACHMENT_DATABASE!,
    manifest,
    command: {
      entrypoint,
      args,
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr,
    },
    dryRun,
    statusMap: JSON.parse(mapping.stdout),
    before,
    after,
  };
  op("recordings:backfill completed", { exitCode: 0, dryRun, directory });
  if (!setup) value.backfill = receipt;
  return receipt;
}
Given(
  "a platform event in published whose start date has passed and which never went live",
  async ({ page }) => {
    const value = state(page);
    value.backfillTitle = backfillTitles[0];
    value.event = await backfillEvent(page, "published");
  },
);
Given("a legacy event in hidden", async ({ page }) => {
  const value = state(page);
  value.backfillTitle = backfillTitles[1];
  value.event = await backfillEvent(page, "hidden", "legacy");
});
Given("a manifest row targeting that event", async ({ page }) => {
  const value = state(page);
  value.backfillTargets = [value.event!];
  if (value.backfillTitle === backfillTitles[0])
    value.backfillTargets.push(await backfillEvent(page, "ended"));
});
Given(
  "a manifest mixing an eligible ended event an already backfilled event and a published event",
  async ({ page }) => {
    const value = state(page);
    value.backfillTitle = backfillTitles[2];
    const fresh = await backfillEvent(page, "ended"),
      done = await backfillEvent(page, "ended"),
      stale = await backfillEvent(page, "published");
    value.backfillTargets = [done];
    const setup = await backfillRun(page, false, true);
    expect(readBackfillOutput(setup.command.stdout).entries[0]!.outcome).toBe(
      "attached+published",
    );
    value.backfillTargets = [fresh, done, stale];
  },
);
When("the platform_admin runs the recording backfill", async ({ page }) => {
  await backfillRun(page, false);
});
When(
  "the platform_admin runs the recording backfill in dry-run mode",
  async ({ page }) => {
    await backfillRun(page, true);
  },
);
Then(
  /^that row is refused with 409 (EVENT_NOT_FINISHED|INVALID_TRANSITION)$/,
  async ({ page }, code: string) => {
    const r = state(page).backfill as BackfillReceipt;
    expect(readBackfillOutput(r.command.stdout).entries[0]).toMatchObject({
      outcome: "refused",
      code,
    });
    expect(r.statusMap[code]).toBe(409);
  },
);
Then("the event state is still published", async ({ page }) => {
  assertBackfillReceipt(
    state(page).backfill as BackfillReceipt,
    backfillTitles[0],
  );
});
Then("the run continues and reports the remaining rows", async ({ page }) => {
  assertBackfillReceipt(
    state(page).backfill as BackfillReceipt,
    backfillTitles[0],
  );
});
Then("no recording was attached to the legacy event", async ({ page }) => {
  assertBackfillReceipt(
    state(page).backfill as BackfillReceipt,
    backfillTitles[1],
  );
});
Then(
  "the report reads would-attach skipped and refused respectively",
  async ({ page }) => {
    assertBackfillReceipt(
      state(page).backfill as BackfillReceipt,
      backfillTitles[2],
    );
  },
);
Then("no recording row audit row or event field changed", async ({ page }) => {
  assertBackfillReceipt(
    state(page).backfill as BackfillReceipt,
    backfillTitles[2],
  );
});

After(async ({ page, $testInfo }) => {
  const value = state(page);
  await $testInfo.attach("recording-attachment", {
    contentType: "application/json",
    body: JSON.stringify({
      sourceHost: "academy",
      caseKind: value.caseKind,
      caseState: value.caseState,
      lifecycle: value.lifecycle?.evidence,
      legacy: value.legacy?.receipt,
      boundary: value.boundary,
      backfill: value.backfill,
      backgrounds: value.backgrounds,
    }),
  });
  await value.visitor?.dispose();
  await value.portal?.close();
  if (value.operator) {
    const issuer = process.env.IDP_ISSUER;
    if (!issuer || new URL(issuer).hostname === "id.doctor.school")
      throw new Error("Refuse production IdP cleanup");
    op("delete exact owned IdP actor", { id: value.operator.zitadel_sub });
    const answer = await fetch(
      `${issuer}/v2/users/${encodeURIComponent(value.operator.zitadel_sub)}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${process.env.IDP_SERVICE_TOKEN}` },
      },
    );
    expect(answer.ok).toBe(true);
  }
  op("retained owned fixture IDs until task database cleanup", {
    events: value.events,
    actor: value.operator?.id,
  });
  states.delete(page);
});
