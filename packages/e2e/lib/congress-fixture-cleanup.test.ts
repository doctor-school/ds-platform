import { expect, it } from "vitest";
import { closeCongressResources } from "./congress-fixture-cleanup.js";

it("EARS-28: nginx quit failure still closes API/PG and restores environment", async () => {
  const seen: string[] = [];
  const failure = new Error("nginx quit failed");
  await expect(
    closeCongressResources([
      () => {
        seen.push("nginx");
        throw failure;
      },
      async () => {
        seen.push("api/pg");
      },
      () => {
        seen.push("restore");
      },
    ]),
  ).rejects.toBe(failure);
  expect(seen).toEqual(["nginx", "api/pg", "restore"]);
});

it("EARS-28: startup and every cleanup failure are preserved together", async () => {
  const original = new Error("startup failed"),
    api = new Error("API close failed"),
    restore = new Error("restore failed");
  let result: unknown;
  try {
    await closeCongressResources(
      [
        () => {
          throw api;
        },
        () => {
          throw restore;
        },
      ],
      [original],
    );
  } catch (error) {
    result = error;
  }
  expect(result).toBeInstanceOf(AggregateError);
  expect((result as AggregateError).errors).toEqual([original, api, restore]);
});
