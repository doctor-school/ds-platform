import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { publicReadonlyOriginals } from "./host-tags.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("EARS-19: CI retains Admin actor credentials without configuring an unbooted storefront login contour", () => {
  const workflow = parse(
    readFileSync(
      new URL(
        "../../../.github/workflows/public-feed-entry.yml",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    jobs: {
      "public-feed-entry": {
        env: Record<string, string>;
        steps: { name?: string; run?: string; env?: Record<string, string> }[];
      };
    };
  };
  const job = workflow.jobs["public-feed-entry"];
  const configure = job.steps.find(({ name }) =>
    name?.startsWith("Configure the existing Admin actor fixture"),
  )!;
  const provision = job.steps.find(
    ({ name }) => name === "Provision the IdP project, client and roles",
  )!;
  const exported = Object.fromEntries(
    [
      ...configure.run!.matchAll(/echo '([A-Z_]+)=([^']*)' >> "\$GITHUB_ENV"/g),
    ].map(([, name, value]) => [name!, value!]),
  );
  const exportPattern = provision.run!.match(
    /grep -E '([^']+)' \.\/idp-provision\.out >> "\$GITHUB_ENV"/,
  )![1]!;
  const provisionOutput = [
    "IDP_PROJECT_ID=fixture-project",
    "IDP_CLIENT_ID=fixture-admin-client",
    "IDP_CLIENT_SECRET=fixture-admin-secret",
    "IDP_ACADEMY_CLIENT_ID=fixture-academy-client",
    "IDP_DOCTOR_CLIENT_ID=fixture-doctor-client",
  ];
  const projected = {
    ...job.env,
    ...exported,
    ...provision.env,
    ...Object.fromEntries(
      provisionOutput
        .filter((line) => new RegExp(exportPattern).test(line))
        .map((line) => line.split("=")),
    ),
    ...Object.fromEntries(
      (
        provision.run!.match(/for name in ([A-Z_ ]+); do/)?.[1]?.split(" ") ??
        []
      ).map((name) => [name, "fixture-secret-file-value"]),
    ),
  };
  expect(projected.IDP_ISSUER).toBe("http://localhost:9080");
  expect(projected.IDP_PROJECT_ID).toBe("fixture-project");
  expect(projected.IDP_CLIENT_ID).toBe("fixture-admin-client");
  expect(projected.IDP_CLIENT_SECRET).toBe("fixture-admin-secret");
  for (const field of [
    "IDP_SIGN_IN_BASE_URI",
    "IDP_BACK_CHANNEL_LOGOUT_URI",
    "IDP_ACADEMY_REDIRECT_URI",
    "IDP_ACADEMY_POST_LOGOUT_URI",
    "IDP_DOCTOR_REDIRECT_URI",
    "IDP_DOCTOR_POST_LOGOUT_URI",
    "IDP_ACADEMY_CLIENT_ID",
    "IDP_DOCTOR_CLIENT_ID",
    "IDP_ACADEMY_CLIENT_KEY",
    "IDP_DOCTOR_CLIENT_KEY",
    "IDP_SECRET_ENV_FILE",
    "INTERNAL_API_TOKEN",
    "SIGN_IN_RECORD_KEY",
    "SIGN_IN_ACADEMY_LOGIN_URL",
    "SIGN_IN_DOCTOR_LOGIN_URL",
  ])
    expect(projected[field], field).toBeUndefined();
});

it("EARS-12: the owned contour runs Academy once and Doctor twice with zero retries", async () => {
  vi.stubEnv("E2E_PUBLIC_READONLY", "1");
  vi.stubEnv("E2E_FEED_ENTRY_BOOT", "0");
  vi.resetModules();
  const { default: config } = await import("../feed-entry.config.js");
  expect(config.projects!.map((project) => project.name)).toEqual([
    "doctor",
    "academy",
  ]);
  for (const { host, title } of publicReadonlyOriginals) {
    const selected = config.projects!.filter((project) =>
      (project.grep as RegExp).test(`${host} feature ${title} @host:${host}`),
    );
    expect(selected.map((project) => project.name)).toEqual([host]);
  }
  expect(config.retries).toBe(0);
});
