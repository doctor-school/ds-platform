#!/usr/bin/env node
// tools/deploy/env-local.mjs — resolve operator secrets from the canonical local
// source `~/.ds-platform/.env.local` for the LOCAL deploy path (Issue #950).
//
// Why this exists: `deploy:prod` runs `release-notes.mjs` LOCALLY on the operator's
// box (ADR-0012 — SSH deploy, no CI), where GitHub Actions `secrets.*` do not
// exist and nothing sources `~/.ds-platform/.env.local`. So `MATTERMOST_WEBHOOK_URL`
// is unset locally and the aggregated release digest silently skips green — it has
// NEVER fired on the local deploy path. This tiny helper backfills such keys from
// the same `.env.local` the dev stand already reads (SMTP/S3/IDP creds live there),
// so the local deploy path resolves them without duplicating a third inline parser.
//
// Two seams, mirroring release-notes.mjs / deployment-record.mjs:
//   - `parseDotenv(text)` — PURE: parse `KEY=VAL` lines → a `{ key: val }` object.
//     Same rules as run.mjs's loadEnv: skip blank/`#` lines, split on the FIRST
//     `=`, strip one layer of surrounding matched single/double quotes.
//   - `loadEnvLocal({ home, envFile })` — the I/O seam. NEVER throws: reads the
//     first existing of `[DS_PLATFORM_ENV_FILE, ~/.ds-platform/.env.local]` and
//     returns `parseDotenv(content)`, or `{}` on any missing file / read error.
//
// Importing this module fires NO I/O (the same entry-point guard the sibling deploy
// seams use), so `release-notes.mjs` can import `loadEnvLocal` freely.

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Parse `.env`-style text into a `{ key: val }` object. PURE — no I/O.
 *
 * Rules (identical to tools/dev/run.mjs's loadEnv):
 *   - trim each line; skip blank lines and `#` comments;
 *   - split on the FIRST `=` (so `=` inside a value is preserved);
 *   - lines with no `=` are skipped;
 *   - strip exactly one layer of surrounding matched single/double quotes.
 *
 * @param {string} text
 * @returns {Record<string,string>}
 */
export function parseDotenv(text) {
  const env = {};
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
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

/**
 * Read the operator's local secret file and return its parsed map. I/O seam —
 * NEVER throws: a missing file or any read error resolves to `{}` (the local
 * deploy path must never break on an absent `.env.local`).
 *
 * Looks up the first existing of `[envFile, ~/.ds-platform/.env.local]`.
 *
 * @param {object}   [opts]
 * @param {string}   [opts.home]     home dir (default `os.homedir()`).
 * @param {string}   [opts.envFile]  explicit override (default `$DS_PLATFORM_ENV_FILE`).
 * @returns {Record<string,string>}
 */
export function loadEnvLocal({
  home = homedir(),
  envFile = process.env.DS_PLATFORM_ENV_FILE,
} = {}) {
  const candidates = [envFile, join(home, ".ds-platform", ".env.local")].filter(
    Boolean,
  );
  try {
    const file = candidates.find((p) => existsSync(p));
    if (!file) return {};
    return parseDotenv(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Choose the effective webhook URL: an already-set process-env value ALWAYS wins
 * (CI provides `secrets.MATTERMOST_WEBHOOK_URL`); otherwise fall back to the
 * `.env.local` map; `null` when neither has it. PURE — no env mutation, no I/O.
 *
 * @param {Record<string,string|undefined>} processEnv
 * @param {Record<string,string>}           envLocalMap
 * @returns {string|null}
 */
export function resolveWebhookUrl(processEnv, envLocalMap) {
  const fromEnv = processEnv?.MATTERMOST_WEBHOOK_URL;
  if (fromEnv) return fromEnv;
  const fromLocal = envLocalMap?.MATTERMOST_WEBHOOK_URL;
  return fromLocal || null;
}

// Run only as the entry point — keep the pure seams importable without any I/O,
// the same guard release-notes.mjs / deployment-record.mjs use.
const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  process.stdout.write(
    "[env-local] this module exposes parseDotenv / loadEnvLocal / " +
      "resolveWebhookUrl as importable seams; it is imported by " +
      "tools/deploy/release-notes.mjs, not run standalone.\n",
  );
}
