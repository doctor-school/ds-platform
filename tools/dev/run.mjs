#!/usr/bin/env node
// DS Platform — dev-stand DX launcher (portable, cross-platform).
//
// Backs the `pnpm dev:*` scripts (setup-design §9). Reads the personal
// `.env.local`, picks a transport, and drives `docker compose` against the
// dev-stand. Two recipes are supported from one launcher:
//
//   - SSH recipe   (DEV_SSH_HOST set)  — syncs infra/dev-stand/ to the remote
//                                        box and runs `docker compose` there
//                                        over the native ssh client.
//   - host-only    (DEV_SSH_HOST empty)— runs `docker compose` on the local
//                                        Docker daemon.
//
// Recipe-specific snapshot/rollback logic lives in tools/dev/recipes/<recipe>/
// and is streamed to the box over ssh — the portable launcher stays
// recipe-agnostic (setup-design §9.1).

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const STAND_DIR = join(REPO_ROOT, 'infra', 'dev-stand');
const RECIPE_DIR = join(HERE, 'recipes', 'truenas-hybrid');

const COMMANDS = ['up', 'down', 'logs', 'restart', 'psql', 'snapshot', 'rollback', 'reset-db', 'status'];

function fail(msg) {
  console.error(`dev: ${msg}`);
  process.exit(1);
}

function usage() {
  console.error(
    [
      'Usage: node tools/dev/run.mjs <command> [args]   (via `pnpm dev:<command>`)',
      '',
      '  up                 start the dev-stand (detached)',
      '  down               stop the dev-stand (volumes preserved)',
      '  logs [service]     follow logs (all services, or one)',
      '  restart [service]  restart all services, or one',
      '  psql               open a psql shell on the dev database',
      '  snapshot <desc>    take a pre-migration snapshot (recipe-specific)',
      '  rollback <name>    roll the database back to a snapshot (recipe-specific)',
      '  reset-db           drop + recreate the database volume, then start',
      '  status             list dev-stand containers',
    ].join('\n'),
  );
  process.exit(2);
}

// --- env -------------------------------------------------------------------

function loadEnv() {
  const candidates = [
    process.env.DS_PLATFORM_ENV_FILE,
    join(homedir(), '.ds-platform', '.env.local'),
    join(STAND_DIR, '.env.local'),
  ].filter(Boolean);
  const file = candidates.find((p) => existsSync(p));
  if (!file) {
    fail(
      `no .env.local found. Looked in:\n  ${candidates.join('\n  ')}\n` +
        'Copy infra/dev-stand/.env.example to ~/.ds-platform/.env.local and fill it in.',
    );
  }
  const env = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

// Resolve the active recipe config from .env.local. Memoised — the first
// command that needs it triggers the (possibly failing) env load.
let cfgCache = null;
function cfg() {
  if (cfgCache) return cfgCache;
  const env = loadEnv();
  const sshHost = (env.DEV_SSH_HOST || '').trim();
  const remoteDir = (env.DEV_REMOTE_DIR || '~/ds-platform-dev-stand').trim();
  if (sshHost && ['', '~', '~/', '/', '.', './'].includes(remoteDir)) {
    fail(`DEV_REMOTE_DIR resolves to an unsafe path: "${remoteDir}"`);
  }
  const overrideFile = (
    env.DEV_COMPOSE_OVERRIDE || join(homedir(), '.ds-platform', 'compose.override.yml')
  ).trim();
  cfgCache = {
    sshHost,
    remoteDir,
    useSudo: /^(1|true|yes)$/i.test((env.DEV_DOCKER_SUDO || '').trim()),
    overrideFile,
    hasOverride: existsSync(overrideFile),
  };
  return cfgCache;
}

// --- shell helpers ---------------------------------------------------------

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.error) fail(`could not spawn ${cmd}: ${r.error.message}`);
  return r.status ?? 1;
}

// Single-quote a value for a POSIX remote shell.
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

const composeFileFlags = () =>
  cfg().hasOverride ? '-f compose.core.yml -f compose.override.yml' : '-f compose.core.yml';

// Push infra/dev-stand/ (+ the personal override) to the remote box so the
// compose file and its bind-mounted config dirs exist on the daemon side.
function syncToRemote() {
  const { sshHost, remoteDir, hasOverride, overrideFile } = cfg();
  const tar = spawnSync('tar', ['-czf', '-', '-C', STAND_DIR, '.'], {
    stdio: ['inherit', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (tar.error) fail(`could not spawn tar: ${tar.error.message}`);
  if (tar.status !== 0) fail('packing infra/dev-stand/ failed');

  const unpack = `rm -rf ${remoteDir} && mkdir -p ${remoteDir} && tar -xzf - -C ${remoteDir}`;
  const push = spawnSync('ssh', [sshHost, unpack], {
    input: tar.stdout,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (push.error) fail(`could not spawn ssh: ${push.error.message}`);
  if (push.status !== 0) fail('syncing infra/dev-stand/ to the remote box failed');

  if (hasOverride) {
    const ov = spawnSync('ssh', [sshHost, `cat > ${remoteDir}/compose.override.yml`], {
      input: readFileSync(overrideFile),
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    if (ov.status !== 0) fail('syncing compose.override.yml to the remote box failed');
  }
}

// Run a `docker compose <sub...>` invocation against the active recipe.
function compose(sub, { tty = false } = {}) {
  const { sshHost, remoteDir, useSudo, hasOverride, overrideFile } = cfg();
  if (sshHost) {
    syncToRemote();
    const remote = `cd ${remoteDir} && ${useSudo ? 'sudo ' : ''}docker compose ${composeFileFlags()} ${sub.join(' ')}`;
    return run('ssh', tty ? ['-t', sshHost, remote] : [sshHost, remote]);
  }
  const flags = hasOverride
    ? ['-f', 'compose.core.yml', '-f', overrideFile]
    : ['-f', 'compose.core.yml'];
  return run('docker', ['compose', ...flags, ...sub], { cwd: STAND_DIR });
}

// Stream a recipe script to the remote box and run it with `bash -s`.
function runRecipeScript(name, scriptArgs) {
  const script = join(RECIPE_DIR, name);
  if (!existsSync(script)) fail(`recipe script missing: ${script}`);
  const quoted = scriptArgs.map(shq).join(' ');
  const r = spawnSync('ssh', [cfg().sshHost, `bash -s -- ${quoted}`], {
    input: readFileSync(script),
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (r.error) fail(`could not spawn ssh: ${r.error.message}`);
  return r.status ?? 1;
}

// --- commands --------------------------------------------------------------

function cmdSnapshot(desc) {
  if (!desc) fail('usage: pnpm dev:snapshot <description>');
  if (!cfg().sshHost) {
    console.warn('dev:snapshot: host-only recipe has no snapshot support — skipping (setup-design §9.1).');
    return 0;
  }
  return runRecipeScript('snapshot.sh', [desc]);
}

function cmdRollback(name) {
  if (!name) fail('usage: pnpm dev:rollback <snapshot-name>');
  if (!cfg().sshHost) {
    console.warn('dev:rollback: host-only recipe has no snapshot support — skipping (setup-design §9.1).');
    return 0;
  }
  if (compose(['stop', 'postgres']) !== 0) fail('could not stop postgres before rollback');
  const code = runRecipeScript('rollback.sh', [name]);
  compose(['start', 'postgres']);
  return code;
}

function cmdResetDb() {
  console.warn('dev:reset-db: dropping the dev database volume.');
  compose(['down', '-v']);
  const code = compose(['up', '-d']);
  console.warn('dev:reset-db: schema migrate + seed are wired once apps/api lands (setup-design §11 OQ-4).');
  return code;
}

function dispatch(cmd, rest) {
  switch (cmd) {
    case 'up':
      return compose(['up', '-d']);
    case 'down':
      return compose(['down']);
    case 'status':
      return compose(['ps']);
    case 'logs':
      return compose(['logs', '-f', ...rest]);
    case 'restart':
      return compose(['restart', ...rest]);
    case 'psql':
      return compose(['exec', 'postgres', 'psql', '-U', 'ds', '-d', 'ds_dev'], { tty: true });
    case 'snapshot':
      return cmdSnapshot(rest[0]);
    case 'rollback':
      return cmdRollback(rest[0]);
    case 'reset-db':
      return cmdResetDb();
    default:
      return usage();
  }
}

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || !COMMANDS.includes(cmd)) usage();
process.exit(dispatch(cmd, rest));
