import { describe, expect, it } from "vitest";

import {
  IMPORT_HISTORY_USAGE,
  ImportHistoryUsageError,
  parseImportHistoryArgs,
} from "./telegram-import-history-cli.js";

describe("048 Telegram history import — operator arguments", () => {
  it("048 EARS-30: --source and --export parse in either order, the pnpm `--` separator ignored", () => {
    expect(
      parseImportHistoryArgs([
        "--",
        "--source",
        "t.me/bbmacademy",
        "--export",
        "/export/result.json",
      ]),
    ).toEqual({ source: "t.me/bbmacademy", exportPath: "/export/result.json" });
    expect(
      parseImportHistoryArgs([
        "--export",
        "/export/result.json",
        "--source",
        "t.me/bbmacademy",
      ]),
    ).toEqual({ source: "t.me/bbmacademy", exportPath: "/export/result.json" });
  });

  it.each([
    [[], "--source <t.me/address> is required"],
    [
      ["--source", "t.me/bbmacademy"],
      "--export <path to result.json> is required",
    ],
    [["--source", "--export", "/export/result.json"], "--source needs a value"],
    [["--source", "t.me/bbmacademy", "--export"], "--export needs a value"],
    [["--channel", "t.me/bbmacademy"], "unknown argument: --channel"],
  ])(
    "048 EARS-30: malformed arguments are refused with the problem and the usage (%j)",
    (argv, problem) => {
      let thrown: unknown;
      try {
        parseImportHistoryArgs(argv);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(ImportHistoryUsageError);
      expect((thrown as Error).message).toBe(
        `${problem}\n${IMPORT_HISTORY_USAGE}`,
      );
    },
  );
});
