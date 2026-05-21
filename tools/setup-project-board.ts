#!/usr/bin/env tsx
/**
 * tools/setup-project-board.ts — one-shot setup for the org-level GitHub
 * Projects v2 board "DS Platform".
 *
 * Spec: apps/docs/content/specs/tech/2026-05-21-dsp-198-github-projects-v2-board-design.md
 *
 * Safety: this script uses `execa` with an explicit args array (NOT a shell
 * string), so no command injection is possible. All inputs come from typed
 * constants or `gh` JSON output — never user-supplied free text.
 *
 * What it does (declarative desired state):
 *   - Creates org-level project "DS Platform" under `doctor-school` (idempotent).
 *   - Creates custom single-select field `Area` with the option set from §3.2.
 *   - Ensures the built-in `Status` field has the four target options.
 *   - Backfills every Issue + PR from `doctor-school/ds-platform` as project items,
 *     sets Status from open/closed, Area from conventional-commit heuristics. Kind
 *     is NOT set as a custom field — for Issues use the native Type field (org
 *     Settings → Issue Types), for PRs use existing labels (feature / bug / chore
 *     / refactor / docs / tooling).
 *   - Prints UI steps for the six workflows (§3.3) and four views (§3.4) — these
 *     pieces of Projects v2 are configured via the web UI; the GraphQL surface
 *     for workflow toggles is preview-only and brittle.
 *
 * Idempotency: every mutation is preceded by an existence probe; re-running
 * after a successful run is a no-op apart from the audit summary.
 *
 * Dry-run: `--dry-run` (or `-n`) prints every intended mutation without
 * executing. Use this before the first real run.
 */
import { execa } from 'execa';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const OWNER = 'doctor-school';
const REPO = 'ds-platform';
const PROJECT_TITLE = 'DS Platform';

const STATUS_OPTIONS = ['Backlog', 'In Progress', 'Review', 'Done'] as const;

const AREA_OPTIONS = [
  'api',
  'promo',
  'portal',
  'admin',
  'cms',
  'cms-payload',
  'mobile',
  'docs',
  'docs-cms',
  'packages',
  'infra',
  'tooling',
  'cross-cutting',
] as const;

type AreaOption = (typeof AREA_OPTIONS)[number];

const WORKFLOWS = [
  {
    key: 'auto-add',
    description: `Auto-add items matching: repo:${OWNER}/${REPO} is:open is:issue,pr → Status=Backlog`,
    uiPath: 'Settings → Workflows → Auto-add to project',
  },
  {
    key: 'item-closed',
    description: 'Item closed → Status=Done',
    uiPath: 'Settings → Workflows → Item closed',
  },
  {
    key: 'pr-opened-ready',
    description: 'PR opened (ready-for-review, not draft) → Status=Review',
    uiPath: 'Settings → Workflows → Pull request opened',
  },
  {
    key: 'pr-draft',
    description: 'PR converted to draft → Status=In Progress',
    uiPath: 'Settings → Workflows → (custom — may require manual setup)',
  },
  {
    key: 'item-reopened',
    description: 'Item reopened → Status=Backlog',
    uiPath: 'Settings → Workflows → Item reopened',
  },
  {
    key: 'auto-archive',
    description: 'Items with Status=Done for >14 days → archived',
    uiPath: 'Settings → Workflows → Auto-archive items',
  },
];

const VIEWS = [
  {
    name: 'Now',
    description: 'Default landing kanban — non-archived items grouped by Status.',
    layout: 'board',
    groupBy: 'Status',
    filter: '',
  },
  {
    name: 'By milestone',
    description: 'PM roadmap surrogate — open work grouped by Milestone.',
    layout: 'table',
    groupBy: 'Milestone',
    filter: 'status:!=Done',
  },
  {
    name: 'By area',
    description: 'Module slice — open work grouped by Area.',
    layout: 'table',
    groupBy: 'Area',
    filter: 'status:!=Done',
  },
];

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const cliArgs = process.argv.slice(2);
const DRY_RUN = cliArgs.includes('--dry-run') || cliArgs.includes('-n');

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(level: 'info' | 'warn' | 'dry' | 'ok', msg: string): void {
  const prefix = { info: '[info]', warn: '[warn]', dry: '[dry] ', ok: '[ok]  ' }[level];
  console.log(`${prefix} ${msg}`);
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

// ---------------------------------------------------------------------------
// gh CLI wrapper (execa with args array — no shell)
// ---------------------------------------------------------------------------

interface GhOk<T> { ok: true; data: T }
interface GhErr { ok: false; stderr: string; exitCode: number }
type GhResult<T> = GhOk<T> | GhErr;

async function ghReadJson<T>(ghArgs: string[]): Promise<GhResult<T>> {
  try {
    const result = await execa('gh', ghArgs, { reject: false });
    if (result.exitCode !== 0) return { ok: false, stderr: result.stderr, exitCode: result.exitCode };
    if (!result.stdout.trim()) return { ok: true, data: undefined as unknown as T };
    return { ok: true, data: JSON.parse(result.stdout) as T };
  } catch (err) {
    const e = err as { stderr?: string; exitCode?: number; message?: string };
    return { ok: false, stderr: e.stderr ?? e.message ?? 'unknown', exitCode: e.exitCode ?? -1 };
  }
}

async function ghMutate(ghArgs: string[]): Promise<GhResult<string>> {
  if (DRY_RUN) {
    log('dry', `gh ${ghArgs.join(' ')}`);
    return { ok: true, data: '' };
  }
  try {
    const result = await execa('gh', ghArgs, { reject: false });
    if (result.exitCode !== 0) return { ok: false, stderr: result.stderr, exitCode: result.exitCode };
    return { ok: true, data: result.stdout };
  } catch (err) {
    const e = err as { stderr?: string; exitCode?: number; message?: string };
    return { ok: false, stderr: e.stderr ?? e.message ?? 'unknown', exitCode: e.exitCode ?? -1 };
  }
}

// ---------------------------------------------------------------------------
// Project resolution / creation
// ---------------------------------------------------------------------------

interface ProjectSummary { number: number; id: string; title: string }

async function findOrCreateProject(): Promise<ProjectSummary | null> {
  section('Project resolution');

  const list = await ghReadJson<{ projects: Array<{ number: number; id: string; title: string }> }>([
    'project', 'list', '--owner', OWNER, '--format', 'json', '--limit', '200',
  ]);
  if (!list.ok) {
    log('warn', `cannot list projects: ${list.stderr}`);
    return null;
  }
  const existing = list.data.projects?.find((p) => p.title === PROJECT_TITLE);
  if (existing) {
    log('ok', `project "${PROJECT_TITLE}" already exists: #${existing.number} (${existing.id})`);
    return existing;
  }

  log('info', `creating project "${PROJECT_TITLE}" under ${OWNER}`);
  const create = await ghMutate([
    'project', 'create', '--owner', OWNER, '--title', PROJECT_TITLE, '--format', 'json',
  ]);
  if (DRY_RUN) {
    log('dry', '(would create project; in real run capture number+id from output)');
    return { number: 0, id: '<dry-run>', title: PROJECT_TITLE };
  }
  if (!create.ok) {
    log('warn', `project create failed: ${create.stderr}`);
    return null;
  }
  try {
    const data = JSON.parse(create.data) as { number: number; id: string; title: string };
    log('ok', `created project #${data.number} (${data.id})`);
    return data;
  } catch {
    log('warn', `project created but could not parse output: ${create.data}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

interface ProjectField {
  id: string;
  name: string;
  dataType: string;
  options?: Array<{ id: string; name: string }>;
}

async function listFields(projectNumber: number): Promise<ProjectField[]> {
  const res = await ghReadJson<{ fields: ProjectField[] }>([
    'project', 'field-list', String(projectNumber),
    '--owner', OWNER, '--format', 'json', '--limit', '50',
  ]);
  return res.ok ? res.data.fields ?? [] : [];
}

async function ensureSingleSelectField(
  projectNumber: number,
  fieldName: string,
  options: readonly string[],
  existing: ProjectField[],
): Promise<void> {
  const current = existing.find((f) => f.name === fieldName);
  if (current) {
    const currentNames = (current.options ?? []).map((o) => o.name);
    const missing = options.filter((o) => !currentNames.includes(o));
    if (missing.length === 0) {
      log('ok', `field "${fieldName}" already configured (${options.length} options)`);
      return;
    }
    log('warn', `field "${fieldName}" exists but is missing: ${missing.join(', ')} — add via UI (Project → Settings → Fields)`);
    return;
  }
  log('info', `creating field "${fieldName}" (single-select, ${options.length} options)`);
  await ghMutate([
    'project', 'field-create', String(projectNumber),
    '--owner', OWNER,
    '--name', fieldName,
    '--data-type', 'SINGLE_SELECT',
    '--single-select-options', options.join(','),
  ]);
}

async function ensureStatusOptions(projectNumber: number, existing: ProjectField[]): Promise<void> {
  const status = existing.find((f) => f.name === 'Status');
  if (!status) {
    log('warn', 'Status field not found — expected built-in; skipping option sync.');
    return;
  }
  const currentNames = (status.options ?? []).map((o) => o.name);
  const missing = STATUS_OPTIONS.filter((o) => !currentNames.includes(o));
  if (missing.length === 0) {
    log('ok', `Status field options already match (${STATUS_OPTIONS.join(' / ')})`);
    return;
  }
  log('warn', `Status missing options: ${missing.join(', ')} — adjust via UI (Project → Settings → Fields → Status). Adding via API requires field-recreate which this script avoids to prevent item data loss.`);
}

// ---------------------------------------------------------------------------
// Heuristics for Kind + Area from conventional-commit titles
// ---------------------------------------------------------------------------

interface Heuristic { area: AreaOption | null }

const AREA_BY_SCOPE: Record<string, AreaOption> = {
  api: 'api',
  promo: 'promo',
  portal: 'portal',
  admin: 'admin',
  cms: 'cms',
  'cms-payload': 'cms-payload',
  mobile: 'mobile',
  docs: 'docs',
  'docs-cms': 'docs-cms',
  packages: 'packages',
  infra: 'infra',
  tooling: 'tooling',
  agents: 'docs',
  adr: 'docs',
  specs: 'docs',
  ci: 'tooling',
  deps: 'tooling',
  'deps-dev': 'tooling',
  release: 'tooling',
  meta: 'cross-cutting',
};

function classify(title: string): Heuristic {
  const m = /^([a-z]+)(?:\(([^)]+)\))?:\s*(.*)$/i.exec(title);
  if (!m) return { area: null };
  const scope = m[2]?.toLowerCase() ?? '';
  const area: AreaOption | null = scope in AREA_BY_SCOPE ? AREA_BY_SCOPE[scope] : null;
  return { area };
}

// ---------------------------------------------------------------------------
// Backfill
// ---------------------------------------------------------------------------

interface Item {
  number: number;
  title: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  url: string;
  type: 'issue' | 'pr';
}

async function fetchAllItems(): Promise<Item[]> {
  const issuesRes = await ghReadJson<Array<{ number: number; title: string; state: string; url: string }>>([
    'issue', 'list', '--state', 'all', '--limit', '500', '--json', 'number,title,state,url',
  ]);
  const prsRes = await ghReadJson<Array<{ number: number; title: string; state: string; url: string }>>([
    'pr', 'list', '--state', 'all', '--limit', '500', '--json', 'number,title,state,url',
  ]);
  const items: Item[] = [];
  if (issuesRes.ok) {
    for (const i of issuesRes.data) {
      items.push({ number: i.number, title: i.title, state: i.state as Item['state'], url: i.url, type: 'issue' });
    }
  } else {
    log('warn', `cannot list issues: ${issuesRes.stderr}`);
  }
  if (prsRes.ok) {
    for (const p of prsRes.data) {
      items.push({ number: p.number, title: p.title, state: p.state as Item['state'], url: p.url, type: 'pr' });
    }
  } else {
    log('warn', `cannot list PRs: ${prsRes.stderr}`);
  }
  return items;
}

async function setFieldValues(
  projectNumber: number,
  projectId: string,
  itemId: string,
  values: Record<string, string | null>,
): Promise<void> {
  const fields = await listFields(projectNumber);
  for (const [fieldName, value] of Object.entries(values)) {
    if (!value) continue;
    const field = fields.find((f) => f.name === fieldName);
    if (!field) {
      log('warn', `field ${fieldName} not found; cannot set "${value}"`);
      continue;
    }
    const option = (field.options ?? []).find((o) => o.name === value);
    if (!option) {
      log('warn', `field ${fieldName} has no option "${value}"; skipping`);
      continue;
    }
    const res = await ghMutate([
      'project', 'item-edit',
      '--id', itemId,
      '--project-id', projectId,
      '--field-id', field.id,
      '--single-select-option-id', option.id,
    ]);
    if (!res.ok) {
      log('warn', `item-edit failed (${fieldName}=${value}): ${res.stderr}`);
    }
  }
}

async function backfill(projectNumber: number, projectId: string): Promise<void> {
  section('Backfill');
  const items = await fetchAllItems();
  log('info', `discovered ${items.length} items (issues + PRs)`);

  const existingRes = await ghReadJson<{ items: Array<{ content?: { url?: string } }> }>([
    'project', 'item-list', String(projectNumber),
    '--owner', OWNER, '--format', 'json', '--limit', '1000',
  ]);
  const existingUrls = new Set<string>(
    existingRes.ok
      ? existingRes.data.items.map((i) => i.content?.url).filter((u): u is string => Boolean(u))
      : [],
  );

  const ambiguous: Array<{ item: Item; reason: string }> = [];

  for (const item of items) {
    if (existingUrls.has(item.url)) {
      log('ok', `#${item.number} already linked, skipping`);
      continue;
    }
    const targetStatus = item.state === 'OPEN' ? 'Backlog' : 'Done';
    const heur = classify(item.title);
    log('info', `#${item.number} (${item.type}, ${item.state}): "${item.title}" → status=${targetStatus} area=${heur.area ?? '∅'}`);

    if (!heur.area) {
      ambiguous.push({ item, reason: 'area unparsed' });
    }

    const addRes = await ghMutate([
      'project', 'item-add', String(projectNumber),
      '--owner', OWNER, '--url', item.url, '--format', 'json',
    ]);
    if (!addRes.ok) {
      log('warn', `item-add failed for #${item.number}: ${addRes.stderr}`);
      continue;
    }
    if (DRY_RUN) continue;

    let addedId: string | null = null;
    try {
      const parsed = JSON.parse(addRes.data) as { id: string };
      addedId = parsed.id;
    } catch {
      log('warn', `cannot parse item-add output for #${item.number}; skipping field set`);
      continue;
    }
    await setFieldValues(projectNumber, projectId, addedId, {
      Status: targetStatus,
      Area: heur.area,
    });
  }

  if (ambiguous.length > 0) {
    section('Items needing manual review');
    for (const a of ambiguous) {
      log('warn', `#${a.item.number} — ${a.reason}: "${a.item.title}"`);
    }
  } else {
    log('ok', 'all items parsed unambiguously');
  }
}

// ---------------------------------------------------------------------------
// Workflows + Views — UI fallback (GraphQL toggles for these are preview-only
// and inconsistent across Projects v2 versions; the script prints UI steps).
// ---------------------------------------------------------------------------

function printWorkflows(): void {
  section('Workflows (UI steps)');
  log('info', 'Open the project → Settings → Workflows → enable each:');
  for (const w of WORKFLOWS) {
    log('info', `  - ${w.key}: ${w.description}`);
    log('info', `    ${w.uiPath}`);
  }
}

function printViews(): void {
  section('Views (UI steps)');
  log('info', 'In the project, click the "+" next to the default view tab and create:');
  for (const v of VIEWS) {
    log('info', `  - "${v.name}" (${v.layout}, group by ${v.groupBy}${v.filter ? `, filter: ${v.filter}` : ''})`);
    log('info', `    ${v.description}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  section('setup-project-board.ts');
  log('info', `mode: ${DRY_RUN ? 'DRY-RUN (no mutations)' : 'REAL RUN'}`);
  log('info', `target: org=${OWNER} project="${PROJECT_TITLE}" backfill-repo=${OWNER}/${REPO}`);
  if (!DRY_RUN) {
    log('warn', 'this run mutates org-level objects. Ensure owner has signed off on dry-run output.');
  }

  const project = await findOrCreateProject();
  if (!project) {
    log('warn', 'project resolution failed; aborting remaining steps');
    process.exit(1);
  }

  section('Link to repo');
  log('info', `linking project #${project.number} to ${OWNER}/${REPO} so it appears under the repo's Projects tab`);
  await ghMutate([
    'project', 'link', String(project.number),
    '--owner', OWNER,
    '--repo', `${OWNER}/${REPO}`,
  ]);

  section('Fields');
  const fields = DRY_RUN ? [] : await listFields(project.number);
  await ensureStatusOptions(project.number, fields);
  await ensureSingleSelectField(project.number, 'Area', AREA_OPTIONS, fields);

  printWorkflows();
  printViews();

  await backfill(project.number, project.id);

  section('Summary');
  log('ok', `mode: ${DRY_RUN ? 'dry-run' : 'real-run'}`);
  log('ok', `project: ${PROJECT_TITLE} (#${project.number}) — ${project.id}`);
  log('info', 'Workflows + views require manual UI configuration per steps above.');
  log('info', 'After UI steps: verify via `gh project view <N> --owner doctor-school --format json`.');
}

main().catch((err) => {
  log('warn', `unhandled: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
