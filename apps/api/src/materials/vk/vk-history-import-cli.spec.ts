import { describe, expect, it } from "vitest";

import {
  VK_IMPORT_HISTORY_USAGE,
  VkImportHistoryUsageError,
  parseVkImportHistoryArgs,
} from "./vk-history-import-cli.js";

describe("048 VK history import — operator arguments", () => {
  it("048 EARS-46: --source parses, the pnpm `--` separator ignored", () => {
    expect(
      parseVkImportHistoryArgs(["--", "--source", "vk.com/bbm.academy"]),
    ).toEqual({ source: "vk.com/bbm.academy" });
  });

  it.each([
    [[], "--source <vk.com/address> is required"],
    [["--source"], "--source needs a value"],
    [["--source", "--export"], "--source needs a value"],
    [["--export", "/x"], "unknown argument: --export"],
  ])(
    "048 EARS-46: malformed arguments are refused with the problem and the usage (%j)",
    (argv, problem) => {
      let thrown: unknown;
      try {
        parseVkImportHistoryArgs(argv);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(VkImportHistoryUsageError);
      expect((thrown as Error).message).toBe(
        `${problem}\n${VK_IMPORT_HISTORY_USAGE}`,
      );
    },
  );
});
