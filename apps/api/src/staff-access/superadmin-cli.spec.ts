import { describe, expect, it } from "vitest";

import { parseSuperadminArgs } from "./superadmin-cli.js";

describe("049 superadmin CLI arguments", () => {
  it("049 EARS-6: grant and remove parse with --email and --by-admin, the pnpm `--` separator ignored", () => {
    expect(
      parseSuperadminArgs([
        "--",
        "grant",
        "--email",
        "a@ds.test",
        "--by-admin",
        "sub-1",
      ]),
    ).toEqual({ verb: "grant", email: "a@ds.test", byAdmin: "sub-1" });
    expect(
      parseSuperadminArgs([
        "remove",
        "--by-admin",
        "sub-1",
        "--email",
        "a@ds.test",
      ]),
    ).toEqual({ verb: "remove", email: "a@ds.test", byAdmin: "sub-1" });
  });

  it.each([
    [[]],
    [["grant", "--email", "a@ds.test"]],
    [["remove", "--by-admin", "sub-1"]],
    [["grant", "--email", "--by-admin", "sub-1"]],
    [["promote", "--email", "a@ds.test", "--by-admin", "sub-1"]],
  ])(
    "049 EARS-6: a missing verb, email or operator is refused (%j)",
    (argv) => {
      expect(parseSuperadminArgs(argv)).toBeNull();
    },
  );
});
