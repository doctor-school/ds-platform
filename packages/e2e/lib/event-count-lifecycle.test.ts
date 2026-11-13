import { expect, it } from "vitest";
import { loadCountLifecycleModule } from "./event-count-fixture.js";

it("loads the actual compiled lifecycle enum and both origin machines through the native ESM boundary", async () => {
  const { EventLifecycleStateSchema, validTransitions } =
    await loadCountLifecycleModule();
  const states = [
    "draft",
    "published",
    "live",
    "ended",
    "hidden",
    "in_archive",
  ];
  expect(EventLifecycleStateSchema.options).toEqual(states);
  const edges = (origin: string) =>
    states.flatMap((state) =>
      validTransitions(state, origin).map((target) => `${state}>${target}`),
    );
  expect(edges("platform")).toEqual([
    "draft>published",
    "published>live",
    "live>ended",
    "ended>hidden",
  ]);
  expect(edges("legacy")).toEqual(["hidden>in_archive", "in_archive>hidden"]);
});
