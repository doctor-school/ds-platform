import { expect, it } from "vitest";
import { accumulateCongressActors } from "./congress-actors.js";

it("EARS-41: retains the known unregistered actor after an unknown priced refusal", () => {
  const known = {
    id: "known-person",
    email: "known@example.org",
    zitadel_sub: "native-sub",
  };
  const captured = accumulateCongressActors([], [known]);
  expect(accumulateCongressActors(captured, [])).toEqual([known]);
});

it("EARS-41: merges by person ID and retains new actor observations without duplicates", () => {
  const known = {
    id: "known-person",
    email: "known@example.org",
    zitadel_sub: "native-sub",
  };
  const barrier = {
    id: "barrier-person",
    email: "barrier@example.org",
    zitadel_sub: "barrier-sub",
  };
  expect(accumulateCongressActors([known], [known, barrier])).toEqual([
    known,
    barrier,
  ]);
});
