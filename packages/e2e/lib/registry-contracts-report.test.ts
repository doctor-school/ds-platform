import { describe, expect, it } from "vitest";
import {
  assertRegistryContractsReport,
  registryContractTitles,
} from "./registry-contracts-report.js";

function report() {
  return {
    errors: [],
    suites: [
      {
        specs: registryContractTitles.map((title, index) => ({
          title,
          tests: [
            {
              projectName: "registry-contracts",
              projectId: "registry-contracts",
              status: "expected",
              results: [
                {
                  status: "passed",
                  retry: 0,
                  attachments: [
                    {
                      name: "registry-contracts",
                      contentType: "application/json",
                      body: Buffer.from(
                        JSON.stringify({
                          sourceHost: index === 0 ? "academy" : "admin",
                          runtime: "admin",
                          backgrounds: (index === 0
                            ? [
                                ["active output kinds", 4],
                                ["Фарма Плюс — Инвестор", 2],
                                ["ЦИТО — Клиническая площадка", 2],
                              ]
                            : [
                                ["administrator with second factor", 1],
                                ["three active organisation roles", 3],
                                ["published primary partner and project", 3],
                              ]
                          ).map(([clause, size]) => ({
                            clause,
                            ids: Array.from({ length: Number(size) }, () =>
                              crypto.randomUUID(),
                            ),
                          })),
                          editors:
                            index === 0
                              ? [crypto.randomUUID(), crypto.randomUUID()]
                              : [],
                        }),
                      ).toString("base64"),
                    },
                  ],
                },
              ],
            },
          ],
        })),
      },
    ],
  };
}
describe("registry original receipts", () => {
  it("accepts the exact three identities with nine complete Background groups", () => {
    expect(() => assertRegistryContractsReport(report())).not.toThrow();
  });
  it("rejects a missing actual Background receipt despite three green labels", () => {
    const value = report();
    value.suites[0]!.specs[0]!.tests[0]!.results[0]!.attachments = [];
    expect(() => assertRegistryContractsReport(value)).toThrow(
      /receipt|Background/,
    );
  });
  it("rejects the wrong inherited host or one editor pretending to cover every editor", () => {
    for (const override of [
      { sourceHost: "admin" },
      { editors: ["same", "same"] },
      { backgrounds: [] },
    ]) {
      const value = report();
      const attachment =
        value.suites[0]!.specs[0]!.tests[0]!.results[0]!.attachments[0]!;
      const body = JSON.parse(
        Buffer.from(attachment.body, "base64").toString("utf8"),
      );
      attachment.body = Buffer.from(
        JSON.stringify({ ...body, ...override }),
      ).toString("base64");
      expect(() => assertRegistryContractsReport(value)).toThrow();
    }
  });
  it("rejects a skip, retry, fourth original, or runner failure", () => {
    const skipped = report();
    skipped.suites[0]!.specs[0]!.tests[0]!.results[0]!.status = "skipped";
    const retry = report();
    retry.suites[0]!.specs[0]!.tests[0]!.results[0]!.retry = 1;
    const fourth = report();
    fourth.suites[0]!.specs.push(fourth.suites[0]!.specs[0]!);
    const failed = { ...report(), errors: [{ message: "runner failed" }] };
    for (const value of [skipped, retry, fourth, failed])
      expect(() => assertRegistryContractsReport(value)).toThrow();
  });
});
