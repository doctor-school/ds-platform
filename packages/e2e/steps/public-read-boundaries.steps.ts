import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { golden } from "@ds/db/seed/golden";
import { expect, type Browser } from "@playwright/test";
import ts from "typescript";

import { HOSTS, baseUrlFor, type HostId } from "../hosts.js";
import { withoutPresignNonces } from "../lib/presigned-url.js";
import { standHttpCredentials } from "../lib/stand-http-credentials.js";
import { When, Then, type StepWorld } from "./support/fixtures.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const slugs = [golden.events.upcoming.slug, "golden-volume-event-418"];
type Render = { body: unknown; html: string };
const reads = new WeakMap<StepWorld, Partial<Record<HostId, Render[]>>>();

async function readHost(browser: Browser, world: StepWorld, id: HostId) {
  const origin = baseUrlFor(HOSTS[id]);
  const credentials = standHttpCredentials();
  const context = await browser.newContext({
    ...(credentials ? { httpCredentials: credentials } : {}),
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
  });
  const result: Render[] = [];
  try {
    for (const slug of slugs) {
      const path =
        id === "doctor" ? "/v1/storefront/doctor/events" : "/v1/public/events";
      const response = await context.request.get(`${origin}${path}/${slug}`);
      expect(response.status()).toBe(200);
      const body = JSON.parse(withoutPresignNonces(await response.text()));
      expect(body).toMatchObject({ slug, state: "published" });
      const page = await context.newPage();
      const document = await page.goto(
        `${origin}${HOSTS[id].eventsPath}/${slug}`,
        { waitUntil: "networkidle" },
      );
      expect(document?.status()).toBe(200);
      await expect(
        page.getByRole("heading", { name: body.title, exact: true, level: 1 }),
      ).toBeVisible();
      await expect(page.getByTestId("storefront-header")).toBeVisible();
      const shell = page.getByTestId("event-page-shell");
      await expect(shell).toBeVisible();
      result.push({
        body,
        html: await shell.evaluate((element) => element.outerHTML),
      });
      await page.close();
    }
    expect(
      (await context.cookies()).filter((cookie) =>
        cookie.name.includes("ds_session"),
      ),
    ).toEqual([]);
  } finally {
    await context.close();
  }
  const state = reads.get(world) ?? {};
  state[id] = result;
  reads.set(world, state);
}

When(
  "an anonymous reader requests the event on doctor.school",
  async ({ browser, world }) => readHost(browser, world, "doctor"),
);
When(
  "an anonymous reader requests the same event on academy.doctor.school",
  async ({ browser, world }) => readHost(browser, world, "academy"),
);

function pair(world: StepWorld) {
  const state = reads.get(world);
  if (!state?.doctor || !state.academy)
    throw new Error("Both anonymous event reads are required");
  return { doctor: state.doctor, academy: state.academy };
}

Then("the two public bodies are content-identical", async ({ world }) => {
  const state = pair(world);
  expect(state.doctor.map((read) => read.body)).toEqual(
    state.academy.map((read) => read.body),
  );
});

Then(
  "the two renders differ only in the storefront header, the route envelope and copy defaults",
  async ({ world }) => {
    const state = pair(world);
    const canonical = (html: string) =>
      withoutPresignNonces(html)
        .replaceAll(baseUrlFor(HOSTS.doctor), "<origin>")
        .replaceAll(baseUrlFor(HOSTS.academy), "<origin>")
        .replaceAll("/webinars", "/events")
        .replaceAll("Эфиры", "События");
    for (let index = 0; index < slugs.length; index++) {
      expect(canonical(state.doctor[index]!.html)).toBe(
        canonical(state.academy[index]!.html),
      );
    }
  },
);

const source = (file: string) => readFileSync(resolve(root, file), "utf8");
function ast(file: string) {
  return ts.createSourceFile(
    file,
    source(file),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

Then(
  "a component-tree scan finds no second page composition, read model or CTA resolver in either application",
  async ({ host }) => {
    expect(["academy", "doctor"]).toContain(host.id);
    for (const file of [
      "apps/doctor/app/(storefront)/events/[slug]/page.tsx",
      "apps/portal/app/webinars/[slug]/(event-page)/page.tsx",
    ]) {
      const tree = ast(file);
      const imports = tree.statements
        .filter(ts.isImportDeclaration)
        .map((node) => (node.moduleSpecifier as ts.StringLiteral).text);
      expect(imports).toHaveLength(2);
      expect(imports).toContain("@ds/event-page/page");
      expect(
        imports.filter((name) =>
          name.endsWith("/events-storefront.host-config"),
        ),
      ).toHaveLength(1);
      const functions = tree.statements.filter(ts.isFunctionDeclaration);
      expect(functions).toHaveLength(1);
      const statements = functions[0]!.body!.statements;
      expect(statements).toHaveLength(1);
      expect(ts.isReturnStatement(statements[0]!)).toBe(true);
      const mounts: ts.JsxSelfClosingElement[] = [];
      const visit = (node: ts.Node) => {
        if (ts.isJsxSelfClosingElement(node)) mounts.push(node);
        ts.forEachChild(node, visit);
      };
      visit(tree);
      expect(mounts).toHaveLength(1);
      expect(mounts[0]!.tagName.getText(tree)).toBe("EventPage");
      expect(
        mounts[0]!.attributes.properties
          .map((prop) => prop.name?.getText(tree))
          .sort(),
      ).toEqual(["config", "params", "searchParams"]);
    }
    expect(source("packages/event-page/src/ui/event-page.tsx")).toMatch(
      /await fetchPublicEventPage\(slug, config.contentSet, h\)/u,
    );
    for (const file of [
      "apps/api/src/events/events.public.controller.ts",
      "apps/api/src/storefront/doctor-events.public.controller.ts",
    ]) {
      expect(source(file)).toMatch(/this\.events\.publicEventPage\(/u);
      expect(source(file)).toMatch(/this\.participation\.cta\(/u);
    }
    expect(source("apps/api/src/events/participation.service.ts")).toMatch(
      /resolveParticipationCta/u,
    );
  },
);

Then(
  /^no import from apps\/portal exists in apps\/doctor and none from apps\/doctor in apps\/portal$/u,
  async ({ host }) => {
    expect(["academy", "doctor"]).toContain(host.id);
    const files = execFileSync(
      "git",
      ["ls-files", "apps/doctor", "apps/portal"],
      { cwd: root, encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .filter((file) => /\.[cm]?[jt]sx?$/u.test(file));
    const violations: string[] = [];
    let imports = 0;
    for (const file of files) {
      const tree = ast(file);
      const other = file.startsWith("apps/doctor/") ? "portal" : "doctor";
      const visit = (node: ts.Node) => {
        const literal =
          ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
            ? node.moduleSpecifier
            : ts.isCallExpression(node) &&
                (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                  node.expression.getText(tree) === "require")
              ? node.arguments[0]
              : undefined;
        if (literal && ts.isStringLiteral(literal)) {
          imports++;
          const target = literal.text.startsWith(".")
            ? resolve(root, dirname(file), literal.text).replaceAll("\\", "/")
            : literal.text;
          if (
            target.includes(`/apps/${other}/`) ||
            target.startsWith(`apps/${other}/`)
          )
            violations.push(`${file}: ${literal.text}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(tree);
    }
    expect(files.length).toBeGreaterThan(0);
    expect(imports).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  },
);
