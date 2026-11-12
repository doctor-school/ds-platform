import { posix, win32 } from "node:path";
import { describe, expect, it } from "vitest";
import { ownedCongressDirectory } from "./congress-directory.js";

describe.each([
  {
    name: "POSIX",
    paths: posix,
    temp: "/tmp",
    runner: "/home/runner/work/_temp",
    foreign: "/var/foreign",
  },
  {
    name: "Windows",
    paths: win32,
    temp: "C:\\Temp",
    runner: "D:\\runner\\_temp",
    foreign: "E:\\foreign",
  },
])("$name congress artifact ownership", ({ paths, temp, runner, foreign }) => {
  const owned = (
    dir: string | undefined,
    ci: string | undefined = "true",
    runnerRoot = runner,
  ) => ownedCongressDirectory(dir, temp, runnerRoot, ci, paths);

  it("EARS-28: accepts an owned runner descendant outside os.tmpdir in CI", () => {
    const dir = paths.join(runner, "congress-originals-3974");
    expect(owned(dir)).toBe(dir);
  });

  it("EARS-28: keeps local os.tmpdir descendants without CI", () => {
    const dir = paths.join(temp, "ds-nonauth-3974");
    expect(owned(dir, "false")).toBe(dir);
  });

  it("EARS-28: refuses runner roots outside CI or when configured relatively", () => {
    expect(() =>
      owned(paths.join(runner, "congress-originals-3974"), "false"),
    ).toThrow();
    expect(() =>
      owned(
        paths.join(runner, "congress-originals-3974"),
        "true",
        "relative-temp",
      ),
    ).toThrow();
  });

  it.each([undefined, "relative", temp, runner, foreign])(
    "EARS-28: refuses missing, relative, root or foreign directory %s",
    (dir) => {
      expect(() => owned(dir)).toThrow();
    },
  );

  it("EARS-28: refuses traversal and sibling-prefix escapes from both roots", () => {
    for (const root of [temp, runner]) {
      expect(() => owned(paths.join(root, "..", "outside"))).toThrow();
      expect(() => owned(root + "-sibling")).toThrow();
    }
  });
});
