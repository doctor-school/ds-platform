import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect } from "@playwright/test";
import {
  countDirectory,
  countOperation,
  countRoot,
} from "./event-count-fixture.js";
import { authoringCapture, authoringSha } from "./event-authoring-runtime.js";
import {
  type AuthoringRow,
  type EventAuthoringWorld,
} from "./event-authoring-world.js";
import { openEventLive } from "../admin/events.js";
import { assertAuthoringTerminal } from "./event-authoring-report.js";

interface Read {
  path: string;
  status: number;
  body: unknown;
  sha256: string;
  terminal: boolean;
}
export async function proveDraftProjections(world: EventAuthoringWorld) {
  const raw: Read[] = [];
  async function read(path: string, status = 200) {
    countOperation("public event projection HTTP read", {
      path,
      database: world.api.database,
    });
    const response = await fetch(world.api.url + path);
    const body: unknown = await response.json();
    appendFileSync(
      resolve(countDirectory(), "public-projections.private.jsonl"),
      JSON.stringify({ path, status: response.status, body }) + "\n",
    );
    assertAuthoringTerminal(body);
    expect(response.status, path).toBe(status);
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const row = body as AuthoringRow;
      if (row.pagination) {
        expect((row.pagination as AuthoringRow).hasMore, path).toBe(false);
        expect((row.pagination as AuthoringRow).nextCursor, path).toBeNull();
      }
      if ("remaining" in row) expect(row.remaining, path).toBe(0);
      if ("nextFrom" in row) expect(row.nextFrom, path).toBeNull();
    }
    const result = {
      path,
      status: response.status,
      body,
      sha256: authoringSha(JSON.stringify(body)),
      terminal: true,
    };
    raw.push(result);
    return result;
  }
  const contains = (value: Read, id: string) =>
    expect(JSON.stringify(value.body), value.path).toContain(id);
  const absent = (value: Read, ids: string[]) =>
    ids.forEach((id) =>
      expect(JSON.stringify(value.body), value.path).not.toContain(id),
    );
  const admin = world.admin.bind(world);
  const book = (await read("/v1/public/specialties")).body as {
    entries: { id: string; code: string; isOther: boolean }[];
  };
  const specialty = book.entries.find((entry) => !entry.isOther)!;
  expect(specialty).toBeDefined();
  const direction = await admin("POST", "/v1/admin/directions", {
    title: `4061 ${randomUUID()}`,
  });
  await admin(
    "POST",
    `/v1/admin/directions/${direction.id}/publish`,
    {},
    Number(direction.version),
  );
  await admin("POST", "/v1/admin/direction-specialties", {
    directionId: direction.id,
    specialtyMinzdravId: specialty.id,
  });
  const expert = await admin("POST", "/v1/admin/experts", {
    familyName: "Проверочная",
    givenName: "Анна",
    professionalRole: "Врач",
    credentials: "к.м.н.",
    affiliation: "Клиника",
    bio: "Тестовый эксперт",
  });
  await admin(
    "POST",
    `/v1/admin/experts/${expert.id}/publish`,
    {},
    Number(expert.version),
  );
  const project = await admin("POST", "/v1/admin/projects", {
    title: `4061 ${randomUUID()}`,
    description: "Полная программа",
    stage: "running",
    defaultAudience: "doctors",
  });
  await admin("POST", "/v1/admin/project-experts", {
    projectId: project.id,
    expertId: expert.id,
    role: "curator",
  });
  const kind = await admin("POST", "/v1/admin/project-output-kinds", {
    title: `4061 ${randomUUID()}`,
  });
  let projectDetail = await admin("GET", `/v1/admin/projects/${project.id}`);
  await admin(
    "PUT",
    `/v1/admin/projects/${project.id}/results`,
    { results: [{ outputKindId: kind.id, title: "Программа" }] },
    Number(projectDetail.version),
  );
  projectDetail = await admin("GET", `/v1/admin/projects/${project.id}`);
  await admin(
    "POST",
    `/v1/admin/projects/${project.id}/publish`,
    {},
    Number(projectDetail.version),
  );
  const draft = world.eventId;
  await admin("POST", "/v1/admin/event-directions", {
    eventId: draft,
    directionId: direction.id,
  });
  await admin("POST", "/v1/admin/event-projects", {
    eventId: draft,
    projectId: project.id,
  });
  await admin("POST", "/v1/admin/event-experts", {
    eventId: draft,
    expertId: expert.id,
    role: "Спикер",
    position: 0,
  });
  const detail = await world.detail(draft);
  const msk = world.events.get(draft)!.msk;
  const month = String(detail.startsAt).slice(0, 7),
    year = month.slice(0, 4);
  const horizon = (await read("/v1/public/events?timeframe=upcoming")).body as {
    horizon: { today: string };
  };
  expect(horizon.horizon.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await world.fillCreateForm("doctor live control");
  const controlMsk = new Date(Date.now() - 60000 + 10800000)
    .toISOString()
    .slice(0, 16);
  world.pendingMsk = controlMsk;
  await world.page.locator("#startsAtMsk").fill(controlMsk);
  await world.page.getByTestId("event-audience").selectOption("doctors");
  await world.page.locator("#specialties").fill(specialty.code);
  const control = await world.saveNewEvent("doctor live control");
  await admin("POST", "/v1/admin/event-directions", {
    eventId: control,
    directionId: direction.id,
  });
  await world.publish(control);
  await openEventLive(world.page);
  await world.fillCreateForm("doctor draft companion");
  world.pendingMsk = msk;
  await world.page.locator("#startsAtMsk").fill(msk);
  await world.page.getByTestId("event-audience").selectOption("doctors");
  await world.page.locator("#specialties").fill(specialty.code);
  const doctorDraft = await world.saveNewEvent("doctor draft companion");
  await admin("POST", "/v1/admin/event-directions", {
    eventId: doctorDraft,
    directionId: direction.id,
  });
  const doctorDetail = await world.detail(doctorDraft),
    q = encodeURIComponent(String(doctorDetail.title));
  const countPath = `/v1/public/events/month-counts?year=${year}&project=${project.slug}`;
  const routes: Record<string, string> = {
    "academy-detail": `/v1/public/events/${draft}`,
    "doctor-detail": `/v1/storefront/doctor/events/${doctorDraft}`,
    "academy-participation": `/v1/public/events/${draft}/participation`,
    "doctor-participation": `/v1/storefront/doctor/events/${doctorDraft}/participation`,
    "academy-bare": "/v1/public/events",
    "academy-upcoming": `/v1/public/events?timeframe=upcoming&project=${project.slug}`,
    "academy-past": `/v1/public/events?timeframe=past`,
    "academy-month": `/v1/public/events?month=${month}`,
    "academy-month-counts": countPath,
    "academy-live": "/v1/public/events/live",
    "doctor-feed": `/v1/storefront/doctor/events?q=${q}`,
    "doctor-past": "/v1/storefront/doctor/events?tense=past",
    "doctor-month": `/v1/storefront/doctor/events/month?month=${month}&q=${q}`,
    "doctor-month-counts": `/v1/storefront/doctor/events/month-counts?year=${year}&q=${q}`,
    "doctor-live": "/v1/storefront/doctor/events/live",
    "specialty-events": `/v1/storefront/feed/${specialty.code}/events`,
    "event-directions": `/v1/public/events/${draft}/directions`,
    "event-projects": `/v1/public/events/${draft}/projects`,
    "event-speakers": `/v1/public/events/${draft}/speakers`,
    "direction-events": `/v1/public/directions/${direction.id}/events`,
    "project-events": `/v1/public/projects/${project.id}/events`,
    "project-page": `/v1/public/projects/${project.id}`,
    "project-scale": "/v1/public/projects/scale",
    statistics: "/v1/public/statistics",
  };
  const native = await import(
    pathToFileURL(
      resolve(countRoot, "apps/api/dist/storefront/statistics.service.js"),
    ).href
  );
  const statisticsService = world.api.app.get<{ refresh(): Promise<void> }>(
    native.StatisticsService,
  );
  countOperation("native owning StatisticsService scheduled-refresh mechanism");
  await statisticsService.refresh();
  const negative: Record<string, Read> = {};
  for (const [key, path] of Object.entries(routes)) {
    negative[key] = await read(
      path,
      /(?:detail|participation)$|^event-/.test(key) ? 404 : 200,
    );
    if (negative[key]!.status === 200)
      absent(negative[key]!, [draft, doctorDraft]);
  }
  for (const path of [
    "/v1/public/events?timeframe=upcoming",
    "/v1/storefront/doctor/events",
    `/v1/storefront/doctor/events/month?month=${month}`,
    `/v1/storefront/doctor/events/live?q=${q}`,
    `/v1/storefront/feed/${specialty.code}`,
    `/v1/storefront/feed/${specialty.code}/adjacent`,
  ])
    absent(await read(path), [draft, doctorDraft]);
  const sum = (body: unknown) =>
    (body as { count: number }[]).reduce((total, row) => total + row.count, 0);
  expect(sum(negative["academy-month-counts"]!.body)).toBe(0);
  expect(sum(negative["doctor-month-counts"]!.body)).toBe(0);
  expect((negative["project-page"]!.body as AuthoringRow).sinceYear).toBeNull();
  const positive: Record<string, Read> = {};
  positive["academy-live"] = await read(routes["academy-live"]!);
  contains(positive["academy-live"]!, world.backgroundId);
  positive["doctor-live"] = await read(routes["doctor-live"]!);
  contains(positive["doctor-live"]!, control);
  positive["specialty-events"] = await read(routes["specialty-events"]!);
  contains(positive["specialty-events"]!, control);
  await world.publish(draft);
  await world.publish(doctorDraft);
  for (const key of [
    "academy-detail",
    "doctor-detail",
    "academy-bare",
    "academy-upcoming",
    "academy-month",
    "doctor-feed",
    "doctor-month",
    "direction-events",
    "project-events",
  ]) {
    positive[key] = await read(routes[key]!);
    contains(positive[key]!, key.startsWith("doctor") ? doctorDraft : draft);
  }
  for (const [key, id] of [
    ["event-directions", direction.id],
    ["event-projects", project.id],
    ["event-speakers", expert.id],
  ]) {
    positive[String(key)] = await read(routes[String(key)]!);
    contains(positive[String(key)]!, String(id));
  }
  for (const key of ["academy-participation", "doctor-participation"])
    positive[key] = await read(routes[key]!);
  for (const key of ["academy-month-counts", "doctor-month-counts"]) {
    positive[key] = await read(routes[key]!);
    expect(sum(positive[key]!.body)).toBe(1);
  }
  positive["project-page"] = await read(routes["project-page"]!);
  expect((positive["project-page"]!.body as AuthoringRow).sinceYear).toBe(
    Number(year),
  );
  positive["project-scale"] = await read(routes["project-scale"]!);
  const scaleDelta =
    Number((positive["project-scale"]!.body as AuthoringRow).broadcasts) -
    Number((negative["project-scale"]!.body as AuthoringRow).broadcasts);
  expect(scaleDelta).toBe(1);
  for (const [key, id] of [
    ["academy-past", world.backgroundId],
    ["doctor-past", control],
  ]) {
    await world.page.goto(`/events/${id}`);
    await world.page.getByTestId("action-close").click();
    await expect(world.page.getByTestId("state-ended")).toBeVisible();
    positive[key!] = await read(routes[key!]!);
    contains(positive[key!]!, id!);
  }
  countOperation("native owning StatisticsService refresh after controls");
  await statisticsService.refresh();
  positive.statistics = await read(routes.statistics!);
  const oracle = (
    await world.api.query(
      "SELECT count(*)::int AS n FROM events WHERE record_status='active' AND state!='draft' AND audience='doctors' AND starts_at BETWEEN now()-interval '1 year' AND now()",
    )
  ).rows[0]!.n;
  expect((positive.statistics.body as AuthoringRow).eventsPerYear).toBe(oracle);
  expect(Number(oracle)).toBeGreaterThan(0);
  const projections = Object.keys(routes).map((key) => ({
    key,
    negativeStatus: negative[key]!.status,
    draftAbsent: true,
    positiveStatus: positive[key]!.status,
    positiveVerified: true,
    terminal: negative[key]!.terminal && positive[key]!.terminal,
    negativeSha256: negative[key]!.sha256,
    positiveSha256: positive[key]!.sha256,
    negativePath: negative[key]!.path,
    positivePath: positive[key]!.path,
  }));
  world.proof = {
    drafts: [
      {
        eventId: draft,
        audience: "experts",
        state: detail.state,
        msk,
        instant: detail.startsAt,
      },
      {
        eventId: doctorDraft,
        audience: "doctors",
        state: doctorDetail.state,
        msk,
        instant: doctorDetail.startsAt,
      },
    ],
    projections,
    monthCountBefore: 0,
    monthCountAfter: 1,
    projectScaleDelta: scaleDelta,
    statistics: oracle,
    statisticsOracle: oracle,
    today: horizon.horizon.today,
  };
  authoringCapture("draft-projections.private.json", {
    raw,
    proof: world.proof,
    taxonomy: { direction, expert, project, kind },
    control,
    doctorDraft,
  });
}
