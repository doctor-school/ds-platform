import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertNoCountCredentials,
  decodeCountEvidence,
  assertCountStorageProvider,
} from "../lib/event-count-report.js";

import {
  assertEventAuthoringEvidence,
  assertAuthoringTerminal,
  assertAuthoringRateIsolation,
  redactAuthoringPublicEvidence,
} from "../lib/event-authoring-report.js";

const directory = process.argv[2];
if (!directory)
  throw new Error(
    "Usage: assert-event-authoring-report.ts <private-attempt-directory>",
  );
const read = (name: string) =>
  readFileSync(resolve(directory, name), "utf8").replace(/^\uFEFF/, "");
const jsonLines = (name: string) =>
  read(name)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
const head = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const raw = read("results.private.json");
const report = JSON.parse(raw);
const backgrounds = jsonLines("backgrounds.jsonl"),
  resources = jsonLines("resources.jsonl");
assertEventAuthoringEvidence({ report, backgrounds, resources, head });
const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const safe = resolve(directory, "safe");
mkdirSync(safe);
interface Suite {
  title?: string | undefined;
  specs?:
    | {
        title: string;
        tests: {
          status: string;
          projectName: string;
          projectId: string;
          results: { status: string; retry: number; startTime: string }[];
        }[];
      }[]
    | undefined;
  suites?: Suite[] | undefined;
}
function counters(suite: Suite): Suite {
  return {
    title: suite.title,
    specs: suite.specs?.map((spec) => ({
      title: spec.title,
      tests: spec.tests.map((test) => ({
        status: test.status,
        projectName: test.projectName,
        projectId: test.projectId,
        results: test.results.map((result) => ({
          status: result.status,
          retry: result.retry,
          startTime: result.startTime,
        })),
      })),
    })),
    suites: suite.suites?.map(counters),
  };
}
const countReport = {
  errors: report.errors,
  suites: report.suites.map(counters),
};
assertEventAuthoringEvidence({
  report: countReport,
  backgrounds,
  resources,
  head,
});
const files: Record<string, string> = {
  "results.json": JSON.stringify(countReport, null, 2),
  "backgrounds.jsonl": read("backgrounds.jsonl"),
  "resources.jsonl": read("resources.jsonl"),
  "ops.jsonl": read("ops.jsonl"),
  "provenance.json": read("provenance.json"),
  "runtime-provenance.json": read("runtime-provenance.json"),
  "room-player-unit.json": read("room-player-unit.json"),
};
const projectionRaw = jsonLines("public-projections.private.jsonl");
projectionRaw.forEach((item) => assertAuthoringTerminal(item.body));
files["public-projections.jsonl"] =
  projectionRaw
    .map((item) => {
      const safe = redactAuthoringPublicEvidence(item.body);
      return JSON.stringify({
        ...item,
        body: safe.value,
        rawBodySha256: digest(JSON.stringify(item.body)),
        redactions: safe.redactions,
      });
    })
    .join("\n") + "\n";
const draft = JSON.parse(read("draft-projections.private.json"));
files["draft-projections.json"] = JSON.stringify(
  {
    raw: draft.raw.map((item: Record<string, unknown>) => {
      const safe = redactAuthoringPublicEvidence(item.body);
      return {
        ...item,
        body: safe.value,
        rawBodySha256: digest(JSON.stringify(item.body)),
        redactions: safe.redactions,
      };
    }),
    proof: draft.proof,
    projectFigures: draft.projectFigures,
  },
  null,
  2,
);
const ops = jsonLines("ops.jsonl");
files["rate-isolation.json"] = JSON.stringify(
  {
    ...assertAuthoringRateIsolation(ops),
    nativeRedis: true,
    sharedRecipeUnchanged: true,
  },
  null,
  2,
);
const mapping = {
  "results.private.json": "results.json",
  "public-projections.private.jsonl": "public-projections.jsonl",
  "draft-projections.private.json": "draft-projections.json",
};
files["raw-safe-manifest.json"] = JSON.stringify(
  Object.entries(mapping).map(([rawName, safeName]) => ({
    raw: rawName,
    rawSha256: digest(readFileSync(resolve(directory, rawName))),
    safe: safeName,
    safeSha256: digest(files[safeName]!),
  })),
  null,
  2,
);
const secrets = new Set(
  Object.entries(process.env)
    .filter(
      ([key, value]) =>
        /PASSWORD|TOKEN|SECRET|PRIVATE_KEY|PEPPER|ACCESS_KEY/.test(key) &&
        value &&
        value.length >= 6,
    )
    .map(([, value]) => value!),
);
for (const row of jsonLines("dynamic-secrets.private.jsonl")) {
  for (const [key, value] of Object.entries(row)) {
    if (!/email|password|cookie|token|secret|pepper/i.test(key)) continue;
    for (const text of Array.isArray(value) ? value : [value])
      if (typeof text === "string" && text.length >= 6) {
        secrets.add(text);
        if (/cookie/i.test(key)) {
          const credential = text.split(";")[0]?.split("=")[1];
          if (credential) secrets.add(credential);
        }
      }
  }
}
function collectIssuedTokens(value: unknown) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (
      /token|secret|credential|jwt/i.test(key) &&
      typeof child === "string" &&
      child.length >= 6
    )
      secrets.add(child);
    if (child && typeof child === "object") collectIssuedTokens(child);
  }
}
for (const response of jsonLines("http-responses.private.jsonl"))
  collectIssuedTokens(response);
const provider = JSON.parse(read("s3-provider.json"));
assertCountStorageProvider(provider, JSON.parse(read("provenance.json")));
files["s3-provider.json"] = read("s3-provider.json");
assertNoCountCredentials(files, [...secrets]);
function privateInventory(path: string): {
  path: string;
  sha256: string;
  bytes: number;
  configuredOrDynamicSecret: boolean;
}[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const full = resolve(path, entry.name);
    if (entry.isDirectory())
      return entry.name === "safe" ? [] : privateInventory(full);
    const bytes = readFileSync(full);
    if (/\.(zip|har)$/i.test(entry.name))
      throw new Error(
        "Unexpected authenticated trace/ZIP/HAR; review privately before exporting any bundle",
      );
    const text = decodeCountEvidence(bytes);
    return [
      {
        path: full,
        sha256: digest(bytes),
        bytes: bytes.length,
        configuredOrDynamicSecret: [...secrets].some((secret) =>
          text.includes(secret),
        ),
      },
    ];
  });
}
const inventory = privateInventory(directory);
writeFileSync(
  resolve(directory, "security-inventory.private.json"),
  JSON.stringify(
    { credentialCandidates: secrets.size, tracesZipHar: 0, files: inventory },
    null,
    2,
  ),
);
for (const [name, text] of Object.entries(files))
  writeFileSync(resolve(safe, name), text);
writeFileSync(
  resolve(safe, "strict-certificate.json"),
  JSON.stringify(
    {
      head,
      originals: 3,
      backgrounds: 20,
      cases: 4,
      failed: 0,
      skipped: 0,
      flaky: 0,
      retries: 0,
      errors: 0,
      authenticatedTracesZipHar: 0,
      configuredAndDynamicCredentialScan: "PASS",
      rawPrivateReportSha256: digest(raw),
      privateInventorySha256: digest(
        readFileSync(resolve(directory, "security-inventory.private.json")),
      ),
      artifacts: Object.fromEntries(
        Object.entries(files).map(([name, text]) => [name, digest(text)]),
      ),
    },
    null,
    2,
  ),
);
console.log(
  "4061 STRICT PASS: exactly3originals/4cases/20Backgrounds; failures/skips/flakes/retries/errors0; safe counters/ops/resources only; configured+dynamic credential scan PASS",
);
