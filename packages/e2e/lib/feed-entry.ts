import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect } from "@playwright/test";
import ts from "typescript";

export const feedEntryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const apiRequire = createRequire(
  resolve(feedEntryRoot, "apps/api/package.json"),
);

export function feedEntryTask(): 3751 | 3772 | 3785 | 3789 | 3797 | 3804 {
  return process.env.E2E_PUBLIC_BOOK_FIELDS === "1"
    ? 3804
    : process.env.E2E_PUBLIC_RECORD_FORMS === "1"
      ? 3797
      : process.env.E2E_PUBLIC_SPECIALTY_MEMORY === "1"
        ? 3789
        : process.env.E2E_PUBLIC_READONLY === "1"
          ? 3785
          : process.env.E2E_PUBLIC_FEED_STATES === "1"
            ? 3772
            : 3751;
}

export function ownedFeedEntryDatabase(
  value: string,
  task: 3751 | 3772 | 3785 | 3789 | 3797 | 3804 = feedEntryTask(),
): string {
  if (!new RegExp(`^/ds_(dev|probe)_${task}$`).test(new URL(value).pathname))
    throw new Error(
      `Feed-entry originals require the dedicated #${task} database`,
    );
  return value;
}

export function feedEntryLog(event: Record<string, unknown>) {
  const path = process.env.E2E_FEED_ENTRY_LOG;
  if (!path)
    throw new Error(
      "E2E_FEED_ENTRY_LOG is required for owned feed-entry proof",
    );
  appendFileSync(
    path,
    JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n",
  );
}

interface FeedEntryProcessIdentity {
  name: "api" | "doctor" | "portal" | "admin";
  platform: NodeJS.Platform;
  root: string;
  command: string;
  cwd?: string;
  executable?: string;
  nodeExecutable?: string;
}

export function assertFeedEntryProcessIdentity(
  identity: FeedEntryProcessIdentity,
) {
  const normalize = (value: string) => {
    const path = value.replaceAll("\\", "/");
    return identity.platform === "win32" ? path.toLowerCase() : path;
  };
  if (identity.platform === "linux") {
    if (
      normalize(identity.cwd ?? "") !==
      `${normalize(identity.root)}/apps/${identity.name}`
    )
      throw new Error("Feed-entry listener has the wrong worktree cwd");
    if (
      !identity.executable ||
      !identity.nodeExecutable ||
      normalize(identity.executable) !== normalize(identity.nodeExecutable)
    )
      throw new Error("Feed-entry listener is not the owning Node executable");
    // Next replaces /proc cmdline with this title after boot; cwd + exe remain OS-owned.
    if (
      identity.name !== "api" &&
      /^next-server \(v[^()\s]+\)\s*$/.test(identity.command)
    )
      return;
  } else if (identity.platform !== "win32") {
    throw new Error("Unsupported feed-entry process identity platform");
  }
  const command = normalize(identity.command);
  if (
    !command.includes(normalize(identity.root)) ||
    !command.includes(
      identity.name === "api" ? "apps/api/dist/main.js" : "next/dist/bin/next",
    )
  )
    throw new Error("Feed-entry listener has the wrong process identity");
}

export function verifyOwnedFeedEntryListeners() {
  if (process.env.E2E_FEED_ENTRY_BOOT !== "1") return;
  for (const [name, url] of [
    ["api", process.env.E2E_API_URL],
    ["doctor", process.env.E2E_DOCTOR_URL],
    ...(process.env.E2E_PUBLIC_READONLY === "1"
      ? ([
          ["portal", process.env.E2E_PORTAL_URL],
          ["admin", process.env.E2E_ADMIN_URL],
        ] as const)
      : []),
    ...(process.env.E2E_PUBLIC_SPECIALTY_MEMORY === "1" ||
    process.env.E2E_PUBLIC_RECORD_FORMS === "1" ||
    process.env.E2E_PUBLIC_BOOK_FIELDS === "1"
      ? ([["admin", process.env.E2E_ADMIN_URL]] as const)
      : []),
  ] as const) {
    const port = Number(new URL(url!).port);
    let pid: number;
    let command: string;
    const identity: Omit<FeedEntryProcessIdentity, "command"> = {
      name,
      platform: process.platform,
      root: feedEntryRoot,
    };
    if (process.platform === "win32") {
      const connections = execFileSync("netstat.exe", ["-ano", "-p", "tcp"], {
        encoding: "utf8",
        windowsHide: true,
      });
      const listener = connections
        .split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/))
        .find(
          (cells) => cells[1]?.endsWith(`:${port}`) && cells[3] === "LISTENING",
        );
      if (!listener) throw new Error(`No owned ${name} listener on ${port}`);
      pid = Number(listener[4]);
      command = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`,
        ],
        { encoding: "utf8", windowsHide: true },
      );
    } else {
      const inodes = new Set(
        ["/proc/net/tcp", "/proc/net/tcp6"].flatMap((path) =>
          readFileSync(path, "utf8")
            .split("\n")
            .map((line) => line.trim().split(/\s+/))
            .filter(
              (cells) =>
                cells[1]?.split(":")[1] ===
                  port.toString(16).toUpperCase().padStart(4, "0") &&
                cells[3] === "0A",
            )
            .map((cells) => `socket:[${cells[9]}]`),
        ),
      );
      const found = readdirSync("/proc")
        .filter((value) => /^\d+$/.test(value))
        .find((value) => {
          try {
            return readdirSync(`/proc/${value}/fd`).some((fd) =>
              inodes.has(readlinkSync(`/proc/${value}/fd/${fd}`)),
            );
          } catch {
            return false;
          }
        });
      if (!found) throw new Error(`No owned ${name} listener on ${port}`);
      pid = Number(found);
      command = readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll(
        "\0",
        " ",
      );
      identity.cwd = readlinkSync(`/proc/${pid}/cwd`);
      identity.executable = readlinkSync(`/proc/${pid}/exe`);
      identity.nodeExecutable = realpathSync(process.execPath);
    }
    assertFeedEntryProcessIdentity({ ...identity, command });
    feedEntryLog({
      command: "verify actual owned listener PID and worktree entry",
      name,
      port,
      pid,
      entry: command.trim(),
      cwd: identity.cwd,
      executable: identity.executable,
    });
  }
}

function parse(name: string, text: string) {
  return ts.createSourceFile(
    name,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}
function imported(file: ts.SourceFile, module: string, exported: string) {
  const declaration = file.statements
    .filter(ts.isImportDeclaration)
    .find(
      (node) =>
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text === module,
    );
  const clause = declaration?.importClause;
  const bindings = clause?.namedBindings;
  const binding =
    bindings && ts.isNamedImports(bindings)
      ? bindings.elements.find(
          (node) =>
            !node.isTypeOnly &&
            (node.propertyName ?? node.name).text === exported,
        )
      : undefined;
  expect(
    clause?.isTypeOnly,
    `${exported} must be a value import from ${module}`,
  ).toBe(false);
  expect(binding, `${exported} must be imported from ${module}`).toBeDefined();
  return binding!.name.text;
}
function component(file: ts.SourceFile, name?: string) {
  const declaration = file.statements
    .filter(ts.isFunctionDeclaration)
    .find(
      (node) =>
        node.modifiers?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
        ) &&
        (name
          ? node.name?.text === name
          : node.modifiers?.some(
              (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
            )),
    );
  expect(
    declaration?.body,
    "The mounted component must have an exported body",
  ).toBeDefined();
  const returned = declaration!.body!.statements.find(
    ts.isReturnStatement,
  )?.expression;
  let root = returned;
  while (root && ts.isParenthesizedExpression(root)) root = root.expression;
  expect(
    root && ts.isJsxElement(root),
    "The component must return its mounted JSX tree",
  ).toBe(true);
  return { declaration: declaration!, root: root as ts.JsxElement };
}

export function assertFeedEntryComposition(source: {
  layout: string;
  frame: string;
}) {
  const layout = parse("layout.tsx", source.layout);
  const frame = parse("storefront-frame.tsx", source.frame);
  const hasChildren = (node: ts.JsxElement) =>
    node.children.some(
      (child) =>
        ts.isJsxExpression(child) &&
        child.expression &&
        ts.isIdentifier(child.expression) &&
        child.expression.text === "children",
    );
  const frameName = imported(
    layout,
    "@/components/storefront-frame",
    "DoctorStorefrontFrame",
  );
  const layoutRoot = component(layout).root;
  expect(layoutRoot.openingElement.tagName.getText(layout)).toBe(frameName);
  expect(
    hasChildren(layoutRoot),
    "The layout must pass route children to the frame",
  ).toBe(true);

  const header = imported(frame, "@ds/storefront-shell", "StorefrontHeader");
  const footer = imported(frame, "@ds/storefront-shell", "StorefrontFooter");
  const hostConfig = imported(frame, "@/lib/shell-config", "doctorShellConfig");
  const siblingOrigin = imported(
    frame,
    "@ds/storefront-shell/sibling-origin",
    "readSiblingOrigin",
  );
  const mounted = component(frame, "DoctorStorefrontFrame");
  const locals = mounted.declaration
    .body!.statements.filter(ts.isVariableStatement)
    .flatMap((node) => [...node.declarationList.declarations]);
  const importedNames = [header, footer, hostConfig, siblingOrigin];
  expect(
    locals.filter(
      (node) =>
        ts.isIdentifier(node.name) && importedNames.includes(node.name.text),
    ),
    "The frame must not replace imported shell components or host config locally",
  ).toEqual([]);
  const children = mounted.root.children.filter(
    (child) => ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child),
  );
  const opening = (node: ts.JsxElement | ts.JsxSelfClosingElement) =>
    ts.isJsxElement(node) ? node.openingElement : node;
  expect(
    children.map((child) => opening(child).tagName.getText(frame)),
  ).toEqual([header, "main", footer]);
  expect(
    ts.isJsxElement(children[1]!) && hasChildren(children[1]!),
    "The frame must render route children in main",
  ).toBe(true);

  const config = locals.find(
    (node) =>
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === hostConfig,
  );
  expect(
    config && ts.isIdentifier(config.name),
    "The frame must use the imported Doctor host config",
  ).toBe(true);
  const configCall = config!.initializer as ts.CallExpression;
  const origin = configCall.arguments[0];
  expect(
    origin && ts.isCallExpression(origin),
    "The Doctor sibling origin must reach the host config",
  ).toBe(true);
  const originCall = origin as ts.CallExpression;
  expect(originCall.expression.getText(frame)).toBe(siblingOrigin);
  expect(originCall.arguments[0]?.getText(frame)).toBe("process.env");
  const host = originCall.arguments[1];
  expect(host && ts.isStringLiteral(host) && host.text).toBe("doctor");
  for (const child of [children[0]!, children[2]!]) {
    const prop = opening(child).attributes.properties.find(
      (node) =>
        ts.isJsxAttribute(node) && node.name.getText(frame) === "config",
    ) as ts.JsxAttribute | undefined;
    const value = prop?.initializer;
    expect(
      value && ts.isJsxExpression(value) && value.expression?.getText(frame),
      "Shared shell components must receive that Doctor config",
    ).toBe(config!.name.getText(frame));
  }
}

export function assertRecordFormComposition(source: string) {
  const file = parse("direction-adjacency-form.tsx", source);
  const names = new Map(
    [
      ["@ds/design-system/blocks", "FormSection"],
      ["@ds/design-system/blocks", "FormFieldGroup"],
      ["@ds/design-system/blocks", "FormActions"],
      ...[
        "Form",
        "FormField",
        "FormItem",
        "FormLabel",
        "FormControl",
        "FormMessage",
      ].map((name) => ["@ds/design-system/form", name]),
    ].map(([module, name]) => [name!, imported(file, module!, name!)]),
  );
  const mounted = component(file, "DirectionAdjacencyForm");
  const localNames: string[] = [];
  function locals(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name))
      localNames.push(node.name.text);
    ts.forEachChild(node, locals);
  }
  locals(mounted.declaration.body!);
  expect(
    localNames.filter((name) => [...names.values()].includes(name)),
  ).toEqual([]);
  expect(mounted.root.openingElement.tagName.getText(file)).toBe(
    names.get("Form"),
  );
  const uses: string[] = [];
  function jsx(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
      uses.push(node.tagName.getText(file));
    ts.forEachChild(node, jsx);
  }
  jsx(mounted.root);
  for (const name of names.values()) expect(uses).toContain(name);
  expect(uses.filter((name) => name === names.get("FormSection"))).toHaveLength(
    2,
  );
  expect(uses.filter((name) => name === "form")).toHaveLength(1);
  expect(
    uses.filter((name) => name === "fieldset" || name === "legend"),
  ).toEqual([]);
  const form = mounted.root.children.find(ts.isJsxElement)!;
  expect(form.openingElement.tagName.getText(file)).toBe("form");
  expect(
    form.children
      .filter(ts.isJsxElement)
      .map((node) => node.openingElement.tagName.getText(file)),
  ).toEqual([
    names.get("FormSection"),
    names.get("FormSection"),
    names.get("FormActions"),
  ]);
}

export function verifyFeedEntryProvenance() {
  const read = (path: string) =>
    readFileSync(resolve(feedEntryRoot, path), "utf8");
  const manifest = JSON.parse(read("design-source/manifest.json")) as {
    files: Record<string, { sha256: string; pulledAt: string }>;
  };
  for (const name of ["doctor-home.dc.html", "ds-shell.dc.html"]) {
    expect(
      createHash("sha256")
        .update(read(`design-source/${name}`))
        .digest("hex"),
    ).toBe(manifest.files[name]!.sha256);
    expect(manifest.files[name]!.pulledAt).toBeTruthy();
  }
  expect(read("design-source/doctor-home.dc.html")).toContain("ds-shell");
  expect(read("design-source/ds-shell.dc.html")).toContain("doctor");
  assertFeedEntryComposition({
    layout: read("apps/doctor/app/(storefront)/layout.tsx"),
    frame: read("apps/doctor/components/storefront-frame.tsx"),
  });
  expect(read("packages/storefront-shell/package.json")).toContain(
    '"@ds/design-system"',
  );
  feedEntryLog({
    command:
      "verify accepted vendored home/shell hashes and shared design-system mount",
  });
}

/** 017 Background: exercise the owning managed read with real, transaction-local rows. */
export async function verifyManagedFeedEntryAdjacency(specialtyId: string) {
  const database = ownedFeedEntryDatabase(
    process.env.E2E_FEED_ENTRY_DATABASE_URL ?? "",
  );
  const { Pool } = apiRequire("pg");
  const { drizzle } = apiRequire("drizzle-orm/node-postgres");
  const { TargetingRepository } = await import(
    pathToFileURL(
      resolve(
        feedEntryRoot,
        "apps/api/dist/storefront/targeting.repository.js",
      ),
    ).href
  );
  const pool = new Pool({
    connectionString: database,
    application_name: `feed-entry-${feedEntryTask()}-precondition`,
  });
  const client = await pool.connect();
  const own = randomUUID(),
    adjacent = randomUUID(),
    link = randomUUID(),
    edge = randomUUID();
  async function query(sql: string, values: unknown[] = []) {
    feedEntryLog({ command: "SQL", database: new URL(database).pathname, sql });
    return client.query(sql, values);
  }
  feedEntryLog({
    command:
      "reserved exact transaction-local managed adjacency before mutation",
    own,
    adjacent,
    link,
    edge,
  });
  try {
    const facts = (
      await query(
        "SELECT current_database() AS name, (SELECT count(*)::int FROM pg_stat_activity WHERE application_name=$1) AS api_connections",
        [`feed-entry-${feedEntryTask()}-api`],
      )
    ).rows[0];
    expect(`/${facts.name}`).toBe(new URL(database).pathname);
    expect(facts.api_connections).toBeGreaterThan(0);
    await query("BEGIN");
    await query(
      "INSERT INTO directions (id,slug,title,status,first_published_at) VALUES ($1,$2,'Entry own','published',now()),($3,$4,'Entry adjacent','published',now())",
      [own, `entry-${own}`, adjacent, `entry-${adjacent}`],
    );
    await query(
      "INSERT INTO direction_specialties (id,direction_id,specialty_minzdrav_id) VALUES ($1,$2,$3)",
      [link, own, specialtyId],
    );
    await query(
      "INSERT INTO direction_adjacency (id,direction_id,adjacent_direction_id,kind) VALUES ($1,$2,$3,'related')",
      [edge, own, adjacent],
    );
    const repository = new TargetingRepository(drizzle(client));
    const ownRows = await repository.findOwnDirections(specialtyId);
    expect(ownRows.map((row: { id: string }) => row.id)).toContain(own);
    const adjacentRows = await repository.findAdjacentDirections([own]);
    expect(adjacentRows).toEqual([
      expect.objectContaining({ id: adjacent, edgeId: edge, kind: "related" }),
    ]);
    feedEntryLog({
      command:
        "owning TargetingRepository read proves managed link and adjacency",
      own,
      adjacent,
      link,
      edge,
    });
  } finally {
    await query("ROLLBACK");
    client.release();
    await pool.end();
  }
}
