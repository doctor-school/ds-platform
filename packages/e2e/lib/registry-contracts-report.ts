import { assertOperationalReport } from "../api-probes/operational-report.js";

export const registryContractTitles = [
  "An output kind in use cannot be retired",
  "A clinic with two roles is registered and published",
  "An organization whose name may not be shown is counted but never displayed",
] as const;

export function assertRegistryContractsReport(value: unknown) {
  assertOperationalReport(value, registryContractTitles, "registry-contracts");
  type Suite = {
    specs?: {
      title: string;
      tests: {
        results: {
          attachments?: { name: string; body?: string; contentType?: string }[];
        }[];
      }[];
    }[];
    suites?: Suite[];
  };
  function visit(suite: Suite) {
    for (const spec of suite.specs ?? []) {
      const receipts = spec.tests[0]!.results[0]!.attachments?.filter(
        (a) => a.name === "registry-contracts",
      );
      if (
        receipts?.length !== 1 ||
        !receipts[0]!.body ||
        receipts[0]!.contentType !== "application/json"
      )
        throw new Error(
          "Registry original requires its actual Background receipt",
        );
      const receipt = JSON.parse(
        Buffer.from(receipts[0]!.body, "base64").toString("utf8"),
      ) as {
        sourceHost: string;
        runtime: string;
        backgrounds: { clause: string; ids: string[] }[];
        editors: string[];
      };
      const is030 = spec.title === registryContractTitles[0];
      if (
        receipt.sourceHost !== (is030 ? "academy" : "admin") ||
        receipt.runtime !== "admin"
      )
        throw new Error(
          "Registry source host identity or Admin runtime mismatch",
        );
      const expected = is030
        ? ([
            ["active output kinds", 4],
            ["Фарма Плюс — Инвестор", 2],
            ["ЦИТО — Клиническая площадка", 2],
          ] as const)
        : ([
            ["administrator with second factor", 1],
            ["three active organisation roles", 3],
            ["published primary partner and project", 3],
          ] as const);
      if (
        !Array.isArray(receipt.backgrounds) ||
        receipt.backgrounds.length !== 3 ||
        expected.some(([clause, size], index) => {
          const group = receipt.backgrounds[index];
          return (
            !group ||
            group.clause !== clause ||
            !Array.isArray(group.ids) ||
            group.ids.length !== size ||
            new Set(group.ids).size !== size ||
            group.ids.some((id) => !/^[0-9a-f-]{36}$/.test(id))
          );
        })
      )
        throw new Error(
          "Registry original did not execute all three Background groups",
        );
      if (
        is030 &&
        (!Array.isArray(receipt.editors) ||
          receipt.editors.length !== 2 ||
          new Set(receipt.editors).size !== 2)
      )
        throw new Error("030 requires two distinct real results editors");
    }
    suite.suites?.forEach(visit);
  }
  (value as { suites: Suite[] }).suites.forEach(visit);
}
