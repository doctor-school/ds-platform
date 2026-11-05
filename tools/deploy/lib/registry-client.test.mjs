// tools/deploy/lib/registry-client.test.mjs — the Registry v2 client and the
// served-images check of the release pre-flight (#3654). `node --test`
// (pnpm test:tools).

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { IMAGE_REGISTRY, RECORDED_IMAGE_NAMES } from "./registry.mjs";
import {
  MULTI_MANIFEST_TYPES,
  registryClient,
  unservedImages,
} from "./registry-client.mjs";

const SHA = "c".repeat(40);
const digest = (n) => `sha256:${n.toString(16).padStart(64, "0")}`;
const SINGLE = "application/vnd.oci.image.manifest.v1+json";

const IMAGES = Object.fromEntries(
  RECORDED_IMAGE_NAMES.map((name, i) => [
    name,
    `${IMAGE_REGISTRY}/${name}@${digest(i + 1)}`,
  ]),
);

/** A registry `request` stub: `served[name]` = {digest, type} or absent (404). */
function registryStub(served) {
  const calls = [];
  const request = async (path, init = {}) => {
    calls.push({ path, method: init.method ?? "GET" });
    const m = path.match(/^\/v2\/(.+)\/manifests\/([^/]+)$/);
    const entry = m && m[2] === SHA ? served[m[1]] : undefined;
    if (!entry)
      return new Response('{"errors":[{"code":"MANIFEST_UNKNOWN"}]}', {
        status: 404,
      });
    if (entry.status) return new Response("boom", { status: entry.status });
    const headers = { "content-type": entry.type ?? SINGLE };
    if (entry.digest) headers["docker-content-digest"] = entry.digest;
    return new Response(init.method === "HEAD" ? null : (entry.body ?? ""), {
      status: 200,
      headers,
    });
  };
  return { request, calls };
}

const allServed = () =>
  Object.fromEntries(
    Object.entries(IMAGES).map(([name, ref]) => [
      name,
      { digest: ref.split("@")[1] },
    ]),
  );

test("unservedImages: every recorded digest served under its <sha> tag → nothing missing", async () => {
  const { request, calls } = registryStub(allServed());
  assert.deepEqual(
    await unservedImages({ images: IMAGES, sha: SHA, request }),
    [],
  );
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.path}`).sort(),
    Object.keys(IMAGES)
      .map((name) => `HEAD /v2/${name}/manifests/${SHA}`)
      .sort(),
  );
});

test("unservedImages: a pruned image (404) is named — the box's «serves no single-manifest tag» refusal", async () => {
  const served = allServed();
  delete served.portal;
  delete served.api;
  const { request } = registryStub(served);
  const missing = await unservedImages({ images: IMAGES, sha: SHA, request });
  assert.deepEqual(
    missing.map((m) => m.name),
    ["api", "portal"],
  );
  assert.match(missing[0].problem, /serves no api:c{12} manifest/);
});

test("unservedImages: a tag that resolves to another digest, or to a multi-manifest index, is named", async () => {
  const served = allServed();
  served.api = { digest: digest(99) };
  served.portal = {
    digest: IMAGES.portal.split("@")[1],
    type: MULTI_MANIFEST_TYPES[0],
  };
  const { request } = registryStub(served);
  const missing = await unservedImages({ images: IMAGES, sha: SHA, request });
  assert.deepEqual(
    missing.map((m) => m.name),
    ["api", "portal"],
  );
  assert.match(missing[0].problem, /not the recorded/);
  assert.match(missing[1].problem, /multi-manifest/);
});

test("unservedImages: no digest header → the digest is the sha256 of the manifest bytes", async () => {
  const body = '{"schemaVersion":2}';
  const bodyDigest = `sha256:${createHash("sha256").update(body).digest("hex")}`;
  const images = { ...IMAGES, api: `${IMAGE_REGISTRY}/api@${bodyDigest}` };
  const { request } = registryStub({ ...allServed(), api: { body } });
  assert.deepEqual(await unservedImages({ images, sha: SHA, request }), []);
});

test("unservedImages: an answer other than 200/404 throws — the check cannot tell, so it refuses", async () => {
  const served = allServed();
  served.api = { status: 401 };
  const { request } = registryStub(served);
  await assert.rejects(
    unservedImages({ images: IMAGES, sha: SHA, request }),
    /HEAD api:c{12} answered HTTP 401/,
  );
});

test("unservedImages: a ref outside the registry is refused", async () => {
  const { request } = registryStub(allServed());
  await assert.rejects(
    unservedImages({
      images: { ...IMAGES, api: `docker.io/library/api@${digest(1)}` },
      sha: SHA,
      request,
    }),
    /not a .* digest reference/,
  );
});

test("registryClient: answers a Bearer challenge with a token fetched under Basic auth", async () => {
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    seen.push({ url: String(url), auth: init.headers?.Authorization ?? null });
    if (String(url).startsWith("https://auth.example/token"))
      return Response.json({ token: "bearer-value" });
    if (!init.headers?.Authorization)
      return new Response("", {
        status: 401,
        headers: {
          "www-authenticate":
            'Bearer realm="https://auth.example/token",service="reg",scope="repository:api:pull"',
        },
      });
    return new Response("", { status: 200 });
  };
  const request = registryClient("pull-secret", { fetchImpl });
  const res = await request(`/v2/api/manifests/${SHA}`, { method: "HEAD" });
  assert.equal(res.status, 200);
  assert.equal(seen.length, 3);
  assert.match(seen[1].url, /scope=repository%3Aapi%3Apull/);
  assert.match(seen[1].auth, /^Basic /);
  assert.equal(seen[2].auth, "Bearer bearer-value");
});
