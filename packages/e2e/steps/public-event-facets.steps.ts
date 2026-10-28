import { golden, isGoldenUuid } from "@ds/db/seed/golden";
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { Given, Then, When, type StepWorld } from "./support/fixtures.js";

type Option = { slug: string; title: string; count: number };
type Reading = {
  data: {
    id: string;
    slug: string;
    title: string;
    format: string;
    state: string;
  }[];
  facets: { project: Option[]; expert: Option[]; topic: Option[] };
  pagination: { hasMore: boolean; nextCursor: string | null };
  horizon: {
    remaining: number;
    nextBatch: number;
    nextCount: number | null;
    nextFrom: string | null;
  };
};
type State = {
  baseline: Reading;
  expertOnly: Reading;
  projectOnly: Reading;
  project: Option;
  expert: Option;
  panel?: Locator;
  empty?: Reading;
  documentStatus?: number;
};
const states = new WeakMap<StepWorld, State>();

function state(world: StepWorld) {
  const value = states.get(world);
  if (!value) throw new Error("014 public facet fixtures were not read");
  return value;
}
function counts(options: Option[]) {
  return options
    .map(({ slug, count }) => ({ slug, count }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}
function count(options: Option[], slug: string) {
  const option = options.find((entry) => entry.slug === slug);
  expect(
    option,
    `eligible facet ${slug} remains in the real read`,
  ).toBeDefined();
  return option!.count;
}
async function read(
  request: APIRequestContext,
  selection: Record<string, string> = {},
): Promise<Reading> {
  const query = new URLSearchParams({ timeframe: "upcoming", ...selection });
  const response = await request.get(`/v1/public/events?${query}`);
  expect(response.status(), "public facet read succeeds").toBe(200);
  return response.json() as Promise<Reading>;
}
async function ready(page: Page) {
  await page.waitForLoadState("load");
  await page.waitForLoadState("networkidle");
}
async function open(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Расписание эфиров",
      exact: true,
    }),
  ).toBeVisible();
  await ready(page);
  return response!.status();
}
function projectGroup(page: Page) {
  return page.getByRole("group", { name: "Проект", exact: true });
}
async function openProject(page: Page): Promise<Locator> {
  await ready(page);
  const trigger = projectGroup(page).getByRole("combobox");
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const panelId = await trigger.getAttribute("aria-controls");
  expect(panelId).toBeTruthy();
  const panel = page.locator(`[id=${JSON.stringify(panelId)}]`);
  await expect(panel).toBeVisible();
  const search = panel.getByRole("combobox", { name: "Найти", exact: true });
  await expect(search).toBeEditable();
  await search.fill("");
  await expect(search).toHaveValue("");
  return panel;
}
async function findOption(panel: Locator, option: Option) {
  await panel
    .getByRole("combobox", { name: "Найти", exact: true })
    .fill(option.title);
  const item = panel.getByRole("option", { name: option.title, exact: true });
  await expect(item).toBeVisible();
  await expect(item).toHaveAttribute("data-value", option.slug);
  await expect(item).not.toHaveAttribute("aria-disabled", "true");
  await expect(item).not.toHaveAttribute("data-disabled", "true");
  await expect(item).toHaveText(option.title);
  return item;
}
async function active(page: Page, s: State, withExpert: boolean) {
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/webinars" &&
      url.searchParams.getAll("project").join() === s.project.slug &&
      (withExpert
        ? url.searchParams.getAll("expert").join() === s.expert.slug
        : !url.searchParams.has("expert")),
  );
  await ready(page);
  await expect(
    projectGroup(page).getByRole("button", {
      name: `Убрать: ${s.project.title}`,
      exact: true,
    }),
  ).toBeVisible();
}
function actualSelection(page: Page): Record<string, string> {
  const url = new URL(page.url());
  expect(url.pathname).toBe("/webinars");
  const selection: Record<string, string> = {};
  for (const key of ["project", "expert", "topic"]) {
    const values = url.searchParams.getAll(key);
    expect(values.length, `bounded ${key} selection`).toBeLessThanOrEqual(1);
    if (values[0]) selection[key] = values[0];
  }
  return selection;
}
function terminal(reading: Reading) {
  expect(reading.data).toEqual([]);
  expect(reading.pagination).toMatchObject({
    hasMore: false,
    nextCursor: null,
  });
  expect(reading.horizon).toMatchObject({
    remaining: 0,
    nextBatch: 0,
    nextCount: null,
    nextFrom: null,
  });
}
async function emptyPage(page: Page) {
  const empty = page.getByTestId("events-feed-empty");
  await expect(empty).toBeVisible();
  await expect(empty).toContainText(/событи|эфир/iu);
  const reset = empty.getByRole("link", { name: /Сбросить/iu });
  await expect(reset).toBeVisible();
  const href = await reset.getAttribute("href");
  expect(href).toBeTruthy();
  const target = new URL(href!, page.url());
  expect(target.pathname).toBe("/webinars");
  expect(target.searchParams.has("project")).toBe(false);
  expect(target.searchParams.has("expert")).toBe(false);
  await expect(page.locator("[data-webinar-card]")).toHaveCount(0);
  await expect(page.getByTestId("events-feed-show-more")).toHaveCount(0);
  // Next's clipped route-announcer is an accessibility landmark, not a feed error.
  await expect(
    page.locator('[role="alert"]:not(#__next-route-announcer__)'),
  ).toHaveCount(0);
  await expect(page.getByTestId("events-feed-error")).toHaveCount(0);
  await expect(
    page.locator("main").getByText(/Не удалось|Ошибка загрузки/iu),
  ).toHaveCount(0);
  await expect(page.getByTestId("storefront-header")).toBeVisible();
}

Given(
  "the real Academy upcoming facet fixtures are available",
  async ({ page, request, host, world }) => {
    expect(host.id).toBe("academy");
    await page.context().clearCookies();
    const baseline = await read(request);
    const expert = baseline.facets.expert.find(
      (option) => option.slug === golden.experts.published.slug,
    );
    expect(expert).toBeDefined();
    expect(expert!.count).toBeGreaterThan(0);
    const expertOnly = await read(request, { expert: expert!.slug });
    expect(expertOnly.data.length).toBeGreaterThan(0);
    const project = baseline.facets.project.find(
      (option) =>
        option.slug.startsWith("golden-volume-project-") &&
        option.count > 0 &&
        expertOnly.facets.project.some(
          (row) => row.slug === option.slug && row.count === 0,
        ),
    );
    expect(
      project,
      "real positive project is disjoint from the positive named expert",
    ).toBeDefined();
    const projectOnly = await read(request, { project: project!.slug });
    expect(projectOnly.data.length).toBeGreaterThan(0);
    const fixture = projectOnly.data.find(
      (event) => event.state === "published" && isGoldenUuid(event.id),
    );
    expect(fixture).toBeDefined();
    const detail = await request.get(`/v1/public/events/${fixture!.slug}`);
    expect(detail.status()).toBe(200);
    expect(await detail.json()).toMatchObject({
      id: fixture!.id,
      slug: fixture!.slug,
      title: fixture!.title,
      state: fixture!.state,
      format: fixture!.format,
    });
    expect(["online", "offline", "hybrid"]).toContain(fixture!.format);
    states.set(world, {
      baseline,
      expertOnly,
      projectOnly,
      expert: expert!,
      project: project!,
    });
  },
);

Given(
  "a facet option that yields no events under the current selection",
  async ({ page, world }) => {
    const s = state(world);
    expect(count(s.expertOnly.facets.project, s.project.slug)).toBe(0);
    await open(page, `/webinars?expert=${encodeURIComponent(s.expert.slug)}`);
    await expect(
      page
        .getByRole("group", { name: "Эксперт", exact: true })
        .getByRole("button", {
          name: `Убрать: ${s.expert.title}`,
          exact: true,
        }),
    ).toBeVisible();
  },
);

When("the visitor opens that facet", async ({ page, world }) => {
  state(world).panel = await openProject(page);
});

Then("the option is listed with no count", async ({ world }) => {
  const s = state(world);
  await findOption(s.panel!, s.project);
});

Then(
  "it is selectable rather than disabled or hidden",
  async ({ page, world }) => {
    const s = state(world);
    await (await findOption(s.panel!, s.project)).click();
    await active(page, s, true);
    const reading = await read(page.request, actualSelection(page));
    terminal(reading);
    await emptyPage(page);
  },
);

Given("a project facet selection is active", async ({ page, world }) => {
  const s = state(world);
  await open(page, "/webinars");
  await (await findOption(await openProject(page), s.project)).click();
  await active(page, s, false);
});

When("the visitor reopens the project facet", async ({ page, world }) => {
  state(world).panel = await openProject(page);
});

Then(
  "the active project chip and every other eligible project option preserve the full project set",
  async ({ page, world }) => {
    const s = state(world);
    const selection = actualSelection(page);
    expect(selection).toEqual({ project: s.project.slug });
    const selected = await read(page.request, selection);
    expect(counts(selected.facets.project)).toEqual(
      counts(s.baseline.facets.project),
    );
    const options = s.panel!.getByRole("option");
    const other = selected.facets.project.filter(
      (option) => option.slug !== s.project.slug,
    );
    await expect(options).toHaveCount(other.length);
    for (const option of other) {
      const row = s.panel!.getByRole("option", {
        name: option.title,
        exact: true,
      });
      await expect(row).toBeVisible();
      await expect(row).toHaveAttribute("data-value", option.slug);
      await expect(row).not.toHaveAttribute("aria-disabled", "true");
    }
    const offered = await options.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-value")),
    );
    const chip = projectGroup(page).getByRole("button", {
      name: `Убрать: ${s.project.title}`,
      exact: true,
    });
    await expect(chip).toBeVisible();
    expect([...offered, s.project.slug].sort()).toEqual(
      selected.facets.project.map((option) => option.slug).sort(),
    );
    await page.keyboard.press("Escape");
  },
);

Then(
  "the expert and topic counts reflect the active project selection",
  async ({ page, world }) => {
    const s = state(world);
    const selection = actualSelection(page);
    expect(selection).toEqual({ project: s.project.slug });
    const selected = await read(page.request, selection);
    expect(counts(selected.facets.expert)).not.toEqual(
      counts(s.baseline.facets.expert),
    );
    expect(count(selected.facets.expert, s.expert.slug)).toBe(0);
    expect(count(s.expertOnly.facets.project, s.project.slug)).toBe(0);
    expect(counts(selected.facets.topic)).not.toEqual(
      counts(s.baseline.facets.topic),
    );
    const changed = selected.facets.topic.filter(
      (option) => option.count !== count(s.baseline.facets.topic, option.slug),
    );
    expect(
      changed.length,
      "project changes actual topic counts",
    ).toBeGreaterThan(0);
    const topic = changed.find((option) => option.count > 0) ?? changed[0]!;
    const topicOnly = await read(page.request, { topic: topic.slug });
    expect(
      count(topicOnly.facets.project, s.project.slug),
      "project/topic intersection agrees in both independent reads",
    ).toBe(topic.count);
    expect(count(s.baseline.facets.topic, topic.slug)).toBeGreaterThan(0);
    await expect(
      page
        .getByRole("group", { name: "Эксперт", exact: true })
        .getByRole("combobox"),
    ).toBeVisible();
    await expect(
      page
        .getByRole("group", { name: "Тема", exact: true })
        .getByRole("combobox"),
    ).toBeVisible();
  },
);

Given("a facet combination that matches no event", async ({ world }) => {
  const s = state(world);
  expect(s.project.count).toBeGreaterThan(0);
  expect(s.expert.count).toBeGreaterThan(0);
  expect(count(s.expertOnly.facets.project, s.project.slug)).toBe(0);
});

When("the listing is read", async ({ page, world }) => {
  const s = state(world);
  s.documentStatus = await open(
    page,
    `/webinars?project=${encodeURIComponent(s.project.slug)}&expert=${encodeURIComponent(s.expert.slug)}`,
  );
  await active(page, s, true);
  s.empty = await read(page.request, actualSelection(page));
});

Then(
  "the response is 200 with empty data and terminal pagination",
  async ({ world }) => {
    const s = state(world);
    expect(s.documentStatus).toBe(200);
    terminal(s.empty!);
  },
);

Then("no error is rendered", async ({ page }) => {
  await emptyPage(page);
});
