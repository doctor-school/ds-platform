// tools/deploy/lib/registry-client.mjs — a Docker Registry v2 client for the container
// registry, shared by registry retention (`../registry-retention.mjs`, the push
// token) and the release pre-flight (`../release-runner.mjs`, the pull-only token),
// plus the pre-flight's served-images check (#3654).
//
// The prod release driver refuses a manifest whose images the registry no longer
// serves (`infra/deploy/bin/release-driver`: `docker manifest inspect --verbose
// <reg>/<name>:<sha>` must answer one manifest whose digest is the recorded one).
// Retention can prune a SHA after its `images-<sha>.json` was recorded, so the
// pre-flight asks the registry the same question before any box step.

import { createHash } from "node:crypto";

import { IMAGE_REGISTRY, recordedImageNames } from "./registry.mjs";
import { parseBearerChallenge } from "./registry-retention.mjs";

/** The registry account; the token authenticates, the name is not checked. */
const REGISTRY_USER = "ds-platform";

/** Manifest types that list other manifests: never what the driver accepts. */
export const MULTI_MANIFEST_TYPES = Object.freeze([
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
]);

export const MANIFEST_ACCEPT = [
  ...MULTI_MANIFEST_TYPES,
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

/**
 * `request(path, {method, headers})` against the registry with `token`: Basic or
 * Bearer, whichever the registry challenges with. A failed token request throws
 * without the token in the message.
 */
export function registryClient(token, { fetchImpl = fetch } = {}) {
  const base = `https://${IMAGE_REGISTRY}`;
  const basic = `Basic ${Buffer.from(`${REGISTRY_USER}:${token}`).toString("base64")}`;
  const bearerByScope = new Map();

  async function authorize(challenge) {
    const bearer = parseBearerChallenge(challenge);
    if (!bearer) return basic;
    const key = bearer.scope ?? "";
    if (!bearerByScope.has(key)) {
      const url = new URL(bearer.realm);
      if (bearer.service) url.searchParams.set("service", bearer.service);
      if (bearer.scope) url.searchParams.set("scope", bearer.scope);
      const res = await fetchImpl(url, { headers: { Authorization: basic } });
      if (!res.ok)
        throw new Error(
          `registry token request for ${key || "(no scope)"} answered HTTP ${res.status}`,
        );
      const body = await res.json();
      const value = body.token ?? body.access_token;
      if (!value)
        throw new Error(
          `registry token response for ${key || "(no scope)"} carries no token`,
        );
      bearerByScope.set(key, `Bearer ${value}`);
    }
    return bearerByScope.get(key);
  }

  return async function request(path, { method = "GET", headers = {} } = {}) {
    const url = path.startsWith("http") ? path : `${base}${path}`;
    let res = await fetchImpl(url, { method, headers });
    if (res.status === 401) {
      const auth = await authorize(res.headers.get("www-authenticate"));
      res = await fetchImpl(url, {
        method,
        headers: { ...headers, Authorization: auth },
      });
    }
    return res;
  };
}

const RECORDED_REF_RE = new RegExp(
  `^${IMAGE_REGISTRY.replaceAll(".", "\\.")}/([a-z0-9][a-z0-9/._-]*)@(sha256:[0-9a-f]{64})$`,
);

async function servedDigest(request, repo, sha, res) {
  const header = res.headers.get("docker-content-digest");
  if (header) return header;
  // No digest header: the digest of a manifest is the sha256 of its exact bytes.
  const get = await request(`/v2/${repo}/manifests/${sha}`, {
    headers: { Accept: MANIFEST_ACCEPT },
  });
  if (!get.ok)
    throw new Error(
      `GET ${repo}:${sha.slice(0, 12)} answered HTTP ${get.status}`,
    );
  return `sha256:${createHash("sha256")
    .update(Buffer.from(await get.arrayBuffer()))
    .digest("hex")}`;
}

/**
 * The recorded images the registry does not serve as the driver requires: under the
 * `<sha>` tag, one manifest, with the recorded digest. `images` is the validated
 * `images` map of `images-<sha>.json`. An answer other than 200 or 404 throws — the
 * check cannot tell, and the caller refuses.
 *
 * @returns {Promise<{name: string, problem: string}[]>} in `RECORDED_IMAGE_NAMES` order
 */
export async function unservedImages({ images, sha, request }) {
  const short = sha.slice(0, 12);
  const out = [];
  for (const name of recordedImageNames(images)) {
    const m = String(images[name]).match(RECORDED_REF_RE);
    if (!m)
      throw new Error(
        `${name}: ${JSON.stringify(images[name])} is not a ${IMAGE_REGISTRY} digest reference`,
      );
    const [, repo, want] = m;
    const res = await request(`/v2/${repo}/manifests/${sha}`, {
      method: "HEAD",
      headers: { Accept: MANIFEST_ACCEPT },
    });
    if (res.status === 404) {
      out.push({
        name,
        problem: `the registry serves no ${repo}:${short} manifest`,
      });
      continue;
    }
    if (!res.ok)
      throw new Error(`HEAD ${repo}:${short} answered HTTP ${res.status}`);
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (MULTI_MANIFEST_TYPES.includes(type)) {
      out.push({
        name,
        problem: `${repo}:${short} is a multi-manifest ${type}, not a single manifest`,
      });
      continue;
    }
    const got = await servedDigest(request, repo, sha, res);
    if (got !== want)
      out.push({
        name,
        problem: `${repo}:${short} resolves to ${got}, not the recorded ${want}`,
      });
  }
  return out;
}
