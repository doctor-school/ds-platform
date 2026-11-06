import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { Given, When, Then, After } from "./support/fixtures.js";
import { entry } from "./public-feed-entry.steps.js";
import { signInAsAdmin } from "../admin/sign-in.js";
import { createReadonlyOperator } from "../lib/public-readonly-fixture.js";
import { createRecordFormFixture } from "../lib/record-form-fixture.js";
import { feedEntryLog, feedEntryRoot } from "../lib/feed-entry.js";
import { bookFieldCases, bookFieldSource } from "../lib/book-fields-report.js";
import { assertBookFieldProvenance } from "../lib/book-fields-provenance.js";

type Detail = {
  id: string;
  title: string;
  slug: string;
  status: string;
  version: number;
  firstPublishedAt: string | null;
};
type Family = "directions" | "direction-adjacency" | "direction-specialties";
type Proof = {
  operator?: Awaited<ReturnType<typeof createReadonlyOperator>>;
  context?: BrowserContext;
  admin?: Page;
  records?: Awaited<ReturnType<typeof createRecordFormFixture>>;
  source?: (typeof bookFieldCases)[number]["source"];
  surface?: string;
  direction?: Detail;
  slug?: string;
  firstPublishedAt?: unknown;
  rows: { family: Family; id: string; status: string; title: string }[];
  styles: unknown[];
};
const states = new WeakMap<Page, Proof>();
function state(page: Page) {
  const value = states.get(page);
  if (!value) throw new Error("Missing book-field operator state");
  return value;
}
async function operator(page: Page, browser: Browser) {
  expect(entry(page).backgrounds).toHaveLength(6);
  const value: Proof = { rows: [], styles: [] };
  states.set(page, value);
  value.records = await createRecordFormFixture(3804);
  value.operator = await createReadonlyOperator(3804);
  value.context = await browser.newContext({
    baseURL: process.env.E2E_ADMIN_URL!,
    locale: "ru-RU",
    viewport: { width: 1440, height: 1000 },
  });
  value.admin = await value.context.newPage();
  await signInAsAdmin(value.admin, value.operator.credentials);
  return value;
}
async function request<T>(
  admin: Page,
  path: string,
  method = "GET",
  body?: unknown,
  version?: number,
  impactToken?: string,
) {
  const result = await admin.evaluate(
    async ({ path, method, body, version, impactToken }) => {
      const headers: Record<string, string> = { accept: "application/json" };
      if (method !== "GET") {
        const cookie = document.cookie
          .split("; ")
          .find((item) => item.startsWith("__Host-ds_admin_csrf="));
        if (!cookie) throw new Error("Actual Admin CSRF cookie absent");
        headers["x-ds-admin-csrf"] = decodeURIComponent(
          cookie.slice(cookie.indexOf("=") + 1),
        );
        headers["idempotency-key"] = crypto.randomUUID();
        headers["content-type"] = "application/json";
        if (version !== undefined) headers["if-match"] = `"${version}"`;
        if (impactToken) headers["lifecycle-impact-token"] = impactToken;
      }
      const response = await fetch(path, {
        method,
        credentials: "include",
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    },
    { path, method, body, version, impactToken },
  );
  expect(result.status).toBe(
    method === "POST" &&
      /^\/v1\/admin\/(directions|direction-adjacency|direction-specialties)$/.test(
        path,
      )
      ? 201
      : 200,
  );
  return result.body as T;
}
async function create(value: Proof, family: Family, body: unknown) {
  const result = await request<Detail>(
    value.admin!,
    `/v1/admin/${family}`,
    "POST",
    body,
  );
  value.records!.own(
    family === "directions"
      ? "direction"
      : family === "direction-adjacency"
        ? "edge"
        : "link",
    result.id,
  );
  return result;
}
async function seedFamilies(value: Proof, statuses = false) {
  const token = randomUUID();
  const a = await create(value, "directions", {
    title: `Кардиология ${token}`,
  });
  const b = await create(value, "directions", {
    title: `Ревматология ${randomUUID()}`,
  });
  value.direction = a;
  const edge = await create(value, "direction-adjacency", {
    directionId: a.id,
    adjacentDirectionId: b.id,
    kind: "related",
  });
  const book = await request<{ entries: { id: string; name: string }[] }>(
    value.admin!,
    "/v1/public/specialties",
  );
  const specialty = book.entries.find((item) => item.name === "Кардиология")!;
  expect(specialty).toBeDefined();
  const link = await create(value, "direction-specialties", {
    directionId: a.id,
    specialtyMinzdravId: specialty.id,
  });
  const persisted = await value.records!.row("direction", a.id);
  expect(persisted.slug).toBe(a.slug);
  expect(a.slug).toBeTruthy();
  expect((await value.records!.row("edge", edge.id)).weight).toEqual(
    expect.any(Number),
  );
  expect(await value.records!.row("link", link.id)).toMatchObject({
    direction_id: a.id,
    specialty_minzdrav_id: specialty.id,
  });
  value.rows = [
    { family: "directions", id: a.id, status: "draft", title: a.title },
    {
      family: "direction-adjacency",
      id: edge.id,
      status: "active",
      title: a.title,
    },
    {
      family: "direction-specialties",
      id: link.id,
      status: "active",
      title: a.title,
    },
  ];
  if (statuses) {
    for (const status of ["published", "retired"]) {
      const direction = await create(value, "directions", {
        title: `Статус ${status} ${randomUUID()}`,
      });
      if (status === "published")
        await request(
          value.admin!,
          `/v1/admin/directions/${direction.id}/publish`,
          "POST",
          {},
          direction.version,
        );
      else {
        const impact = await request<{
          affected: unknown[];
          impactToken: string;
        }>(
          value.admin!,
          `/v1/admin/directions/${direction.id}/lifecycle-impact?transition=retire`,
        );
        expect(impact.affected).toEqual([]);
        await request(
          value.admin!,
          `/v1/admin/directions/${direction.id}/retire`,
          "POST",
          {},
          direction.version,
          impact.impactToken,
        );
      }
      value.rows.push({
        family: "directions",
        id: direction.id,
        status,
        title: direction.title,
      });
    }
    const c = await create(value, "directions", {
      title: `Связь ${randomUUID()}`,
    });
    const retiredEdge = await create(value, "direction-adjacency", {
      directionId: c.id,
      adjacentDirectionId: b.id,
      kind: "related",
    });
    const retiredLink = await create(value, "direction-specialties", {
      directionId: c.id,
      specialtyMinzdravId: specialty.id,
    });
    await request(
      value.admin!,
      `/v1/admin/direction-adjacency/${retiredEdge.id}/retire`,
      "POST",
      {},
      retiredEdge.version,
    );
    await request(
      value.admin!,
      `/v1/admin/direction-specialties/${retiredLink.id}/retire`,
      "POST",
      {},
      retiredLink.version,
    );
    value.rows.push(
      {
        family: "direction-adjacency",
        id: retiredEdge.id,
        status: "retired",
        title: c.title,
      },
      {
        family: "direction-specialties",
        id: retiredLink.id,
        status: "retired",
        title: c.title,
      },
    );
  }
}
async function loadedSurface(value: Proof, family: Family, id: string) {
  const admin = value.admin!;
  if (value.surface === "list") {
    await admin.goto(`/${family}`);
    await expect(admin.getByTestId(`row-${id}`).first()).toBeVisible();
  } else if (value.surface === "record") {
    await admin.goto(`/${family}/${id}`);
    await expect(
      admin.getByTestId(
        family === "directions"
          ? "direction-heading"
          : family === "direction-adjacency"
            ? "direction-adjacency-heading"
            : "direction-specialty-heading",
      ),
    ).toBeVisible();
  } else {
    await admin.goto(`/${family}/create`);
    const form = admin.getByTestId(
      family === "directions"
        ? "direction-form"
        : family === "direction-adjacency"
          ? "direction-adjacency-form"
          : "direction-specialty-form",
    );
    await expect(form).toBeVisible();
    if (family !== "directions")
      await expect(
        form
          .locator("select")
          .first()
          .locator("option")
          .filter({ hasText: value.direction!.title }),
      ).toHaveCount(1);
  }
}
async function hidden(value: Proof, kind: "weight" | "address" | "note") {
  for (const row of value.rows) {
    await loadedSurface(value, row.family, row.id);
    const main = value.admin!.getByRole("main");
    const text = await main.innerText();
    expect(text).not.toMatch(
      kind === "weight"
        ? /\bweight\b|(?:^|\s)Вес(?:\s|$)/i
        : kind === "address"
          ? /адрес страницы|\bslug\b/i
          : /адрес.{0,45}(?:формиру|производ|автомат|назван)|(?:формиру|производ|автомат).{0,45}адрес/i,
    );
    if (kind === "address") expect(text).not.toContain(value.direction!.slug);
    const attributes = await main
      .locator("input,select,textarea")
      .evaluateAll((elements) =>
        elements.map((element) =>
          [
            element.getAttribute("name"),
            element.getAttribute("aria-label"),
            element.getAttribute("placeholder"),
          ].join(" "),
        ),
      );
    expect(attributes.join(" ")).not.toMatch(
      kind === "weight" ? /\bweight\b|вес/i : /\bslug\b|адрес страницы/i,
    );
    const file = `apps/admin/app/${row.family}/${value.surface === "record" ? "[id]/" : value.surface === "create form" ? "create/" : ""}page.tsx`;
    assertBookFieldProvenance(
      file,
      readFileSync(resolve(feedEntryRoot, file), "utf8"),
    );
    const form = `apps/admin/components/${row.family === "directions" ? "direction" : row.family === "direction-adjacency" ? "direction-adjacency" : "direction-specialty"}-form.tsx`;
    assertBookFieldProvenance(
      form,
      readFileSync(resolve(feedEntryRoot, form), "utf8"),
    );
  }
}
Given(
  /^an operator opens the (list|record|create form) of a reference-book record$/,
  async ({ page, browser, $bddContext }, surface: string) => {
    const value = await operator(page, browser);
    value.surface = surface;
    const expected = bookFieldCases.find(
      (item) => "surface" in item.source && item.source.surface === surface,
    )!;
    expect(
      $bddContext.featureUri.replaceAll("\\", "/").endsWith(bookFieldSource),
    ).toBe(true);
    expect($bddContext.bddTestData.pickleLine).toBe(
      "row" in expected.source ? expected.source.row : undefined,
    );
    value.source = expected.source;
    await seedFamilies(value);
  },
);
Then("«Вес» is not rendered", async ({ page }) => {
  await hidden(state(page), "weight");
});
Then("the page address is not rendered", async ({ page }) => {
  await hidden(state(page), "address");
});
Then(
  "no note explaining a derived address is rendered in its place",
  async ({ page }) => {
    await hidden(state(page), "note");
  },
);

When(
  "an operator creates a reference-book record with a Russian title",
  async ({ page, browser, $bddContext }) => {
    const value = await operator(page, browser);
    value.source = { file: bookFieldSource, line: 436 };
    expect($bddContext.bddTestData.pickleLine).toBe(436);
    const admin = value.admin!,
      suffix = randomUUID(),
      title = `Кардиология ${suffix}`;
    value.slug = `kardiologiya-${suffix}`;
    await admin.goto("/directions/create");
    await admin.getByTestId("direction-title").fill(title);
    const pending = admin.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/v1/admin/directions" &&
        r.request().method() === "POST",
    );
    await admin.getByTestId("submit-direction").click();
    const response = await pending;
    const body = (await response.json()) as Detail;
    if (response.status() === 201) value.records!.own("direction", body.id);
    expect(response.status()).toBe(201);
    expect(response.request().postDataJSON()).toEqual({ title });
    value.direction = body;
    value.rows = [
      { family: "directions", id: body.id, status: "draft", title },
    ];
    await expect(admin).toHaveURL(new RegExp(`/directions/${body.id}$`));
    await expect(admin.getByTestId("direction-heading")).toHaveText(title);
  },
);
Then("its page address is transliterated from that title", async ({ page }) => {
  const value = state(page);
  expect(value.direction!.slug).toBe(value.slug);
  expect(
    await value.records!.row("direction", value.direction!.id),
  ).toMatchObject({ slug: value.slug, first_published_at: null });
});
Then("the address is frozen on first publish", async ({ page }) => {
  const value = state(page),
    admin = value.admin!,
    id = value.direction!.id;
  const pending = admin.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === `/v1/admin/directions/${id}/publish` &&
      r.request().method() === "POST",
  );
  await admin.getByTestId("direction-publish").click();
  expect((await pending).status()).toBe(200);
  await expect(admin.getByTestId("direction-status")).toHaveText(
    "Опубликовано",
  );
  await expect(admin.getByTestId("transition-notice")).toBeVisible();
  const first = await value.records!.row("direction", id);
  expect(first.first_published_at).not.toBeNull();
  value.firstPublishedAt = first.first_published_at;
  const title = `Ревматология ${randomUUID()}`;
  await admin.getByTestId("direction-title").fill(title);
  const saved = admin.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === `/v1/admin/directions/${id}` &&
      r.request().method() === "PATCH",
  );
  await admin.getByTestId("submit-direction").click();
  const response = await saved;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toEqual({ title });
  await expect(admin.getByTestId("update-saved")).toBeVisible();
  await admin.reload();
  await expect(admin.getByTestId("direction-heading")).toHaveText(title);
  const actual = await request<Detail>(admin, `/v1/admin/directions/${id}`);
  expect(actual).toMatchObject({
    slug: value.slug,
    title,
    status: "published",
  });
  expect(actual.firstPublishedAt).toBe(
    (first.first_published_at as Date).toISOString(),
  );
  expect(await value.records!.row("direction", id)).toMatchObject({
    slug: first.slug,
    title,
    first_published_at: first.first_published_at,
  });
});
Then(
  "the operator is never shown or asked for the address",
  async ({ page }) => {
    const value = state(page);
    value.surface = "record";
    await hidden(value, "address");
    await hidden(value, "note");
    value.surface = "create form";
    await hidden(value, "address");
    await hidden(value, "note");
  },
);

When(
  "a reference-book list renders a record with a status",
  async ({ page, browser, $bddContext }) => {
    const value = await operator(page, browser);
    value.source = { file: bookFieldSource, line: 443 };
    expect($bddContext.bddTestData.pickleLine).toBe(443);
    await seedFamilies(value, true);
  },
);
async function style(value: Proof, hover: boolean) {
  const admin = value.admin!;
  for (const theme of ["light", "dark"]) {
    for (const row of value.rows) {
      await admin.goto(`/${row.family}`);
      await admin.evaluate((theme) => {
        document.documentElement.classList.toggle("dark", theme === "dark");
        document.documentElement.style.colorScheme = theme;
      }, theme);
      if (row.status === "retired") {
        const toggle = admin.getByTestId(`${row.family}-include-retired`);
        await toggle.focus();
        await toggle.press("Space");
        await expect(toggle).toBeChecked();
      }
      const ground = admin
        .getByRole("row")
        .filter({ has: admin.getByTestId(`row-${row.id}`) });
      await expect(ground).toBeVisible();
      const chip = ground.getByTestId(`status-${row.status}`);
      await expect(chip).toBeVisible();
      await admin.mouse.move(0, 0);
      const before = await ground.evaluate(
        (el) => getComputedStyle(el).backgroundColor,
      );
      if (hover) {
        await ground.hover();
        await expect
          .poll(() =>
            ground.evaluate((el) => getComputedStyle(el).backgroundColor),
          )
          .not.toBe(before);
      }
      const result = await chip.evaluate(
        (el, { status, hover }) => {
          const cs = getComputedStyle(el),
            row = el.closest("tr")!,
            rs = getComputedStyle(row),
            root = getComputedStyle(document.documentElement);
          const tone =
            status === "draft"
              ? "warning"
              : status === "retired"
                ? "destructive"
                : "success";
          const expectedBg = root
              .getPropertyValue(`--color-${tone}-tint`)
              .trim(),
            expectedFg = root
              .getPropertyValue(
                status === "draft"
                  ? "--color-foreground"
                  : `--color-${tone}-text`,
              )
              .trim();
          const canvas = new OffscreenCanvas(1, 1),
            ctx = canvas.getContext("2d")!;
          const rgb = (color: string) => {
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, 1, 1);
            return [...ctx.getImageData(0, 0, 1, 1).data];
          };
          const fg = rgb(cs.color),
            bg = rgb(cs.backgroundColor),
            ground = rgb(rs.backgroundColor);
          const luminance = (c: number[]) =>
            c
              .slice(0, 3)
              .map((v) => {
                const n = v / 255;
                return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
              })
              .reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i]!, 0);
          const a = luminance(fg),
            b = luminance(bg),
            contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          return {
            fg,
            bg,
            ground,
            expectedFg: rgb(expectedFg),
            expectedBg: rgb(expectedBg),
            tint: rgb(root.getPropertyValue("--color-tint").trim()),
            contrast,
            cssForeground: cs.color,
            cssBackground: cs.backgroundColor,
            fontSize: cs.fontSize,
            fontWeight: cs.fontWeight,
            opacity: cs.opacity,
            hover,
            hovered: row.matches(":hover"),
            text: el.textContent,
          };
        },
        { status: row.status, hover },
      );
      const observation = {
        family: row.family,
        id: row.id,
        status: row.status,
        theme,
        ...result,
      };
      value.styles.push(observation);
      feedEntryLog({
        command: "computed actual owned status chip and row state",
        ...observation,
      });
      const tone =
        row.status === "draft"
          ? "warning"
          : row.status === "retired"
            ? "destructive"
            : "success";
      await expect(chip).toHaveClass(
        new RegExp(`(?:^|\\s)bg-${tone}-tint(?:\\s|$)`),
      );
      if (!hover) {
        expect(result.fg).toEqual(result.expectedFg);
        expect(result.bg).toEqual(result.expectedBg);
      }
      expect(result.bg).not.toEqual(result.tint);
      expect
        .soft(
          result.contrast,
          `${row.family}/${row.status}/${theme}/${hover ? "hover" : "rest"}: AA normal-text contrast`,
        )
        .toBeGreaterThanOrEqual(4.5);
      if (hover) {
        expect(result.hovered).toBe(true);
        expect(result.bg).not.toEqual(result.ground);
      }
    }
  }
}
Then(
  "the status renders as a chip on the semantic tint tokens",
  async ({ page }) => {
    await style(state(page), false);
  },
);
Then("no status renders as a bare badge on bg-tint", async ({ page }) => {
  expect(state(page).styles).toHaveLength(14);
});
Then("the chip stays readable while the row is hovered", async ({ page }) => {
  await style(state(page), true);
  expect(state(page).styles).toHaveLength(28);
});

After(async ({ page, $testInfo }) => {
  const value = states.get(page);
  if (!value) return;
  try {
    await $testInfo.attach("public-book-fields", {
      body: JSON.stringify({ source: value.source, styles: value.styles }),
      contentType: "application/json",
    });
    feedEntryLog({
      command: "book-field proof and exact owned cleanup",
      source: value.source,
      rows: value.rows,
    });
  } finally {
    try {
      await value.records?.cleanup();
    } finally {
      try {
        await value.context?.close();
      } finally {
        await value.operator?.cleanup();
        states.delete(page);
      }
    }
  }
});
