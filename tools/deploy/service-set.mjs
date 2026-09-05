#!/usr/bin/env node
// tools/deploy/service-set.mjs — pure seam that derives the per-service verify
// set of a deploy from the TARGET tree's compose file (Issue #1896).
//
// Why this exists. `pnpm deploy:prod --ref <sha>` (#1881 / #1886) ships the
// TARGET tree, not `origin/main`. Every per-service assertion in the deploy
// tooling used to hard-code the service list of the LOCAL checkout
// (`portal + admin + doctor`, `doctor` added by #1860 on 2026-09-03). The first
// live hotfix — base `1455bb9c`, which has no `doctor` service — therefore built
// three images on the box and then demanded a fourth that cannot exist at that
// SHA: `doctor=NOSTART`, deploy aborted pre-swap. The gate was right to fail
// closed; its expectation was wrong.
//
// So the set of SHA-tagged images to boot-probe (#1410) and to success-verify
// (DSO-127 `verifyRunningSha`) is READ from the target's
// `infra/deploy/compose/api-prod/compose.yml` — `git show <target>:<path>` in
// prod.mjs, parsed here. Pure, deterministic, unit-tested
// (`service-set.test.mjs`); no git, no ssh, no I/O.
//
// A service belongs to the set iff its `image:` is SHA-tagged by the deploy,
// i.e. `ds-<repo>:${DEPLOY_SHA…}`. That is exactly the "built and swapped by
// this deploy" contract: upstream pins (zitadel, centrifugo, node) and the
// one-shot `ds-api-migrate:local` runner are not in it.

/** Path of the api-prod compose file inside the repo tree (git-show ref path). */
export const API_PROD_COMPOSE_PATH =
  "infra/deploy/compose/api-prod/compose.yml";

/**
 * Services deliberately excluded from the PRE-SWAP boot probe: the api needs
 * Postgres/Redis/Zitadel on the compose network, so a detached one-shot would
 * fail for reasons unrelated to the image (see `verifyImagesBoot` in prod.mjs).
 * It still belongs to the full set — `verifyRunningSha` asserts it.
 */
export const BOOT_PROBE_EXCLUDED = Object.freeze(["api"]);

/** `image: ds-<repo>:${DEPLOY_SHA}` / `${DEPLOY_SHA:-local}` — the deploy-tagged shape. */
const SHA_TAGGED_IMAGE_RE = /^(ds-[a-z0-9][a-z0-9-]*):\$\{DEPLOY_SHA(?::-[^}]*)?\}$/;

/** Raised for an empty or unusable derivation — the caller must fail closed. */
export class ServiceSetError extends Error {
  constructor(message) {
    super(message);
    this.name = "ServiceSetError";
  }
}

/**
 * Parse the deploy-tagged services out of a compose file's text. Pure.
 *
 * Deliberately a small line scanner rather than a YAML dependency: the deploy
 * tooling is dependency-free by design (it must run from a maintenance branch
 * with no install), and the shape it reads is a two-space-indented `services:`
 * map whose entries carry an `image:` at four spaces and, for the Next apps, a
 * pinned `PORT:` under `environment:` at six.
 *
 * @param {string} composeText raw compose.yml contents
 * @returns {{ name: string, image: string, port: number|null }[]} in declaration order
 */
export function parseDeployServices(composeText) {
  const lines = String(composeText ?? "").split(/\r?\n/);
  const found = [];
  let inServices = false;
  let current = null;

  for (const raw of lines) {
    const line = raw.replace(/\t/g, "  ");
    if (/^\s*(#.*)?$/.test(line)) continue;

    // A top-level key ends the services map (`volumes:`, `name:`, …).
    if (/^\S/.test(line)) {
      inServices = /^services:\s*$/.test(line);
      current = null;
      continue;
    }
    if (!inServices) continue;

    const header = /^ {2}([A-Za-z0-9][A-Za-z0-9._-]*):\s*$/.exec(line);
    if (header) {
      current = { name: header[1], image: null, port: null };
      continue;
    }
    if (!current) continue;

    const image = /^ {4}image:\s*(\S+)/.exec(line);
    if (image) {
      const m = SHA_TAGGED_IMAGE_RE.exec(image[1]);
      if (m) {
        current.image = m[1];
        found.push(current);
      }
      continue;
    }
    // `PORT: "3001"` under `environment:`. The exact key on purpose — never
    // SMS_AERO_ADAPTER_PORT / ZITADEL_DATABASE_POSTGRES_PORT.
    const port = /^ {6}PORT:\s*"?(\d{2,5})"?\s*$/.exec(line);
    if (port && current.image) current.port = Number(port[1]);
  }

  return found.map(({ name, image, port }) => ({ name, image, port }));
}

/**
 * The full set of services this deploy builds, swaps and must verify, derived
 * from the TARGET tree's compose text. Fail-closed: an empty or unparsable
 * derivation throws rather than letting the deploy "verify nothing".
 *
 * @param {string} composeText
 * @param {{ source?: string }} [opts] human label for the error message
 * @returns {{ name: string, image: string, port: number|null }[]}
 */
export function deployServiceSet(composeText, { source } = {}) {
  const at = source ? ` (${source})` : "";
  const services = parseDeployServices(composeText);
  if (services.length === 0) {
    throw new ServiceSetError(
      `no SHA-tagged services found in ${API_PROD_COMPOSE_PATH}${at} —` +
        ` expected at least one \`image: ds-<repo>:\${DEPLOY_SHA…}\` entry.` +
        ` Refusing to deploy: a deploy that verifies nothing is not verified.`,
    );
  }
  const dupes = services
    .map((s) => s.name)
    .filter((n, i, all) => all.indexOf(n) !== i);
  if (dupes.length > 0) {
    throw new ServiceSetError(
      `duplicate service name(s) in ${API_PROD_COMPOSE_PATH}${at}: ${dupes.join(", ")}`,
    );
  }
  return services;
}

/**
 * The subset the PRE-SWAP boot probe runs against (#1410): every deploy-tagged
 * service except the api. Each needs a pinned PORT — without one the probe
 * cannot tell a booted app from a dead one, so an unpinned service is a hard
 * error rather than a silently skipped assertion.
 *
 * @param {{ name: string, image: string, port: number|null }[]} services
 * @returns {{ name: string, image: string, port: number }[]}
 */
export function bootProbeSet(services) {
  const probed = (services ?? []).filter(
    (s) => !BOOT_PROBE_EXCLUDED.includes(s.name),
  );
  const unpinned = probed.filter((s) => !s.port);
  if (unpinned.length > 0) {
    throw new ServiceSetError(
      `service(s) without a pinned \`PORT:\` in ${API_PROD_COMPOSE_PATH}:` +
        ` ${unpinned.map((s) => s.name).join(", ")} — the pre-swap boot probe` +
        ` (#1410) needs the port the image listens on.`,
    );
  }
  if (probed.length === 0) {
    throw new ServiceSetError(
      `the pre-swap boot probe (#1410) derived an EMPTY service set from` +
        ` ${API_PROD_COMPOSE_PATH} — refusing to swap unverified images.`,
    );
  }
  return probed;
}

/** `api + portal + admin` — the human label for a derived set. */
export function formatServiceNames(services) {
  return (services ?? []).map((s) => s.name).join(" + ");
}

/** `ds-api / ds-portal / ds-admin` — the human label for the built repos. */
export function formatServiceImages(services, sep = " + ") {
  return (services ?? []).map((s) => s.image).join(sep);
}
