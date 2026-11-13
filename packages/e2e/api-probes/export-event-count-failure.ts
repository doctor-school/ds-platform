import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertNoCountCredentials,
  eventCountFailureDiagnostic,
} from "../lib/event-count-report.js";

const directory = process.argv[2];
if (!directory)
  throw new Error("A private event-count attempt directory is required");
const read = (name: string) =>
  existsSync(resolve(directory, name))
    ? readFileSync(resolve(directory, name), "utf8")
    : undefined;
const secrets = Object.entries(process.env)
  .filter(
    ([key, value]) =>
      /PASSWORD|TOKEN|SECRET|PRIVATE_KEY|ACCESS_KEY/.test(key) &&
      value &&
      value.length >= 6,
  )
  .map(([, value]) => value!);
const collect = (value: unknown) => {
  if (typeof value === "string" && value.length >= 6) secrets.push(value);
  else if (value && typeof value === "object")
    Object.values(value).forEach(collect);
};
for (const line of read("dynamic-secrets.private.jsonl")
  ?.split(/\r?\n/)
  .filter(Boolean) ?? []) {
  try {
    collect(JSON.parse(line));
  } catch {
    throw new Error(
      "Unreadable private credential inventory; refusing failure export",
    );
  }
}
const diagnostic = {
  ...eventCountFailureDiagnostic(
    read("results.private.json"),
    read("ops.jsonl"),
  ),
  requiredConfigPresent: Object.fromEntries(
    [
      "IDP_CLIENT_ID",
      "IDP_REDIRECT_URI",
      "IDP_PROJECT_ID",
      "IDP_SERVICE_TOKEN",
      "INTERNAL_API_TOKEN",
      "IDP_DOCTOR_CLIENT_ID",
      "IDP_DOCTOR_CLIENT_KEY",
      "IDP_ACADEMY_CLIENT_ID",
      "IDP_ACADEMY_CLIENT_KEY",
      "IDP_SIGN_IN_BASE_URI",
      "SIGN_IN_RECORD_KEY",
      "SIGN_IN_ACADEMY_LOGIN_URL",
      "SIGN_IN_DOCTOR_LOGIN_URL",
      "REDIS_URL",
      "E2E_ADMIN_URL",
      "E2E_EVENT_COUNT_DATABASE_URL",
      "E2E_EVENT_COUNT_S3_ENDPOINT",
      "E2E_EVENT_COUNT_S3_ACCESS_KEY",
      "E2E_EVENT_COUNT_S3_SECRET_KEY",
      "E2E_EVENT_COUNT_S3_BUCKET_UPLOADS",
    ].map((key) => [key, Boolean(process.env[key]?.trim())]),
  ),
};
const text = JSON.stringify(diagnostic, null, 2);
assertNoCountCredentials({ "failure.json": text }, secrets);
mkdirSync(resolve(directory, "failure-safe"), { recursive: true });
writeFileSync(resolve(directory, "failure-safe/failure.json"), text);
console.log(
  "4035 failure-only diagnostic exported; acceptance remains false and raw evidence remains private",
);
