import { describe, expect, it } from "vitest";
import {
  classifyModeAExemption,
  verifyModeAExemption,
} from "../../gh/merge-gate.mjs";
const head = "a".repeat(40);
const release = {
  headRefName: "changeset-release/main",
  author: { is_bot: true, login: "app/github-actions" },
};
const manifest = { name: "@ds/academy-demo", version: "0.1.8", private: true };
const files = [
  {
    baseContent: JSON.stringify(manifest),
    headContent: JSON.stringify({ ...manifest, version: "0.1.9" }),
    filename: "apps/academy-demo/package.json",
    status: "modified",
    additions: 1,
    deletions: 1,
    patch:
      '@@ -1,4 +1,4 @@\n {\n   "name": "@ds/academy-demo",\n-  "version": "0.1.8",\n+  "version": "0.1.9",\n   "private": true,',
  },
  {
    filename: "apps/academy-demo/CHANGELOG.md",
    status: "modified",
    additions: 2,
    deletions: 0,
    patch:
      "@@ -1,2 +1,4 @@\n # @ds/academy-demo\n+## 0.1.9\n+### Patch Changes",
  },
  {
    filename: ".changeset/wise-moons-repeat.md",
    status: "removed",
    additions: 0,
    deletions: 2,
    patch: "@@ -1,2 +0,0 @@\n----\n-Release note",
  },
];
describe("EARS-1920: B6 Version Packages verified exemption", () => {
  it("hydrates exact git comparison blobs and forwards native release metadata at the real call boundary", () => {
    const base = "b".repeat(40);
    const runGit = (args: string[]) => ({
      status: 0,
      stdout:
        args[0] === "merge-base"
          ? base
          : args[0] === "diff"
            ? files.map((file) => file.filename).join("\0") + "\0"
            : args[0] === "show"
              ? args[1].startsWith(base)
                ? files[0].baseContent
                : files[0].headContent
              : "",
    });
    const unhydrated = files.map(
      ({ baseContent: _base, headContent: _head, ...file }) => file,
    );
    expect(
      verifyModeAExemption(
        unhydrated,
        { ...release, baseRefOid: base },
        head,
        runGit,
      ).ok,
    ).toBe(true);
    expect(() =>
      verifyModeAExemption(
        unhydrated,
        { ...release, baseRefOid: base },
        head,
        (args: string[]) =>
          args[0] === "diff"
            ? { status: 0, stdout: "omitted.ts\0" }
            : runGit(args),
      ),
    ).toThrow("complete git comparison");
  });
  it("allows only matching versioned workspace references in a lockfile", () => {
    const lock = {
      importers: {
        ".": {
          dependencies: {
            "@ds/academy-demo": { specifier: "^0.1.8", version: "0.1.8" },
            react: { specifier: "19", version: "19.0.0" },
          },
        },
      },
      settings: { autoInstallPeers: true },
    };
    const next = structuredClone(lock);
    next.importers["."].dependencies["@ds/academy-demo"] = {
      specifier: "^0.1.9",
      version: "0.1.9",
    };
    const file = {
      filename: "pnpm-lock.yaml",
      status: "modified",
      baseContent: JSON.stringify(lock),
      headContent: JSON.stringify(next),
    };
    expect(classifyModeAExemption([...files, file], "", head, release).ok).toBe(
      true,
    );
    next.importers["."].dependencies.react.version = "20.0.0";
    expect(
      classifyModeAExemption(
        [...files, { ...file, headContent: JSON.stringify(next) }],
        "",
        head,
        release,
      ).ok,
    ).toBe(false);
  });
  it("preserves the native release-bot version/changelog/changeset-only shape", () =>
    expect(classifyModeAExemption(files, "", head, release).ok).toBe(true));
  it("rejects a lookalike author or branch", () => {
    expect(
      classifyModeAExemption(files, "", head, {
        ...release,
        author: { is_bot: false, login: "app/github-actions" },
      }).ok,
    ).toBe(false);
    expect(
      classifyModeAExemption(files, "", head, {
        ...release,
        headRefName: "tooling/fake-release",
      }).ok,
    ).toBe(false);
  });
  it("rejects handwritten manifest config, incomplete patch, rename and non-release changes", () => {
    for (const file of [
      {
        ...files[0],
        headContent: JSON.stringify({
          ...manifest,
          version: "0.1.9",
          scripts: { postinstall: "node evil.js" },
        }),
      },
      { ...files[0], baseContent: undefined },
      {
        ...files[0],
        previous_filename: "apps/api/src/main.ts",
        status: "renamed",
      },
      {
        filename: "pnpm-lock.yaml",
        status: "modified",
        additions: 1,
        deletions: 1,
        patch: "@@ -1 +1 @@\n-old\n+unexpected",
      },
      {
        filename: "apps/api/src/main.ts",
        status: "modified",
        additions: 1,
        deletions: 1,
        patch: "@@ -1 +1 @@\n-old\n+new",
      },
    ])
      expect(
        classifyModeAExemption([file, ...files.slice(1)], "", head, release).ok,
      ).toBe(false);
  });
});
