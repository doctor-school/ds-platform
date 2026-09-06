import { isDeepStrictEqual } from "node:util";
import { parse } from "yaml";

export function isVersionPackagesPr(metadata) {
  return (
    metadata?.headRefName === "changeset-release/main" &&
    metadata?.author?.is_bot === true &&
    ["app/github-actions", "github-actions[bot]"].includes(
      metadata.author.login,
    )
  );
}

/** Complete base/head blobs are supplied from the PR's native git comparison. */
export function classifyReleaseFiles(files) {
  const versions = new Map();
  const deny = (reason) => ({
    ok: false,
    reason: `Version Packages: ${reason}`,
  });
  for (const file of files) {
    if (file.previous_filename)
      return deny("renames are not release regeneration");
    const path = file.filename;
    if (/^(?:apps|packages)\/[^/]+\/package\.json$/.test(path)) {
      if (file.status !== "modified")
        return deny(`manifest must already exist: ${path}`);
      let before, after;
      try {
        before = JSON.parse(file.baseContent);
        after = JSON.parse(file.headContent);
      } catch {
        return deny(`complete manifest blobs unavailable: ${path}`);
      }
      const { version: oldVersion, ...oldRest } = before;
      const { version: newVersion, ...newRest } = after;
      const semver = /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/;
      if (
        !semver.test(oldVersion) ||
        !semver.test(newVersion) ||
        oldVersion === newVersion ||
        !isDeepStrictEqual(oldRest, newRest) ||
        typeof before.name !== "string"
      )
        return deny(`handwritten manifest changes beyond version: ${path}`);
      versions.set(before.name, { oldVersion, newVersion });
    } else if (/^(?:apps|packages)\/[^/]+\/CHANGELOG\.md$/.test(path)) {
      if (!["added", "modified"].includes(file.status))
        return deny(`unexpected changelog operation: ${path}`);
    } else if (
      /^\.changeset\/[^/]+\.md$/.test(path) &&
      path !== ".changeset/README.md"
    ) {
      if (file.status !== "removed" || file.additions !== 0)
        return deny(`changesets may only be consumed: ${path}`);
    } else if (path !== "pnpm-lock.yaml" || file.status !== "modified")
      return deny(`not a release artifact: ${path}`);
  }
  if (!versions.size) return deny("no package version bump");
  for (const file of files.filter(
    (file) => file.filename === "pnpm-lock.yaml",
  )) {
    let before, after;
    try {
      before = parse(file.baseContent);
      after = parse(file.headContent);
    } catch {
      return deny("complete lockfile blobs unavailable");
    }
    if (
      !before ||
      !after ||
      typeof before !== "object" ||
      typeof after !== "object"
    )
      return deny("invalid lockfile");
    // Only references to packages versioned in this release may change. All
    // external resolutions, settings, importer keys and package snapshots stay exact.
    for (const [workspace, importer] of Object.entries(
      before.importers ?? {},
    )) {
      for (const kind of [
        "dependencies",
        "devDependencies",
        "optionalDependencies",
      ]) {
        for (const [name, dependency] of Object.entries(importer[kind] ?? {})) {
          const bump = versions.get(name);
          const next = after.importers?.[workspace]?.[kind]?.[name];
          if (!bump || !next) continue;
          for (const key of ["specifier", "version"]) {
            const old = dependency[key];
            if (typeof old !== "string") continue;
            const prefix =
              old.startsWith("^") || old.startsWith("~") ? old[0] : "";
            if (
              old === `${prefix}${bump.oldVersion}` &&
              next[key] === `${prefix}${bump.newVersion}`
            )
              next[key] = old;
          }
        }
      }
    }
    if (!isDeepStrictEqual(before, after))
      return deny("lockfile changes beyond versioned workspace references");
  }
  return {
    ok: true,
    reason:
      "Native Version Packages bot; complete diff contains only verified release regeneration",
  };
}
