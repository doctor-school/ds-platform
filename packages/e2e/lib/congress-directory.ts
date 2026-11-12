import path from "node:path";

export function ownedCongressDirectory(
  directory: string | undefined,
  temporaryRoot: string,
  runnerTemporaryRoot: string | undefined,
  ci: string | undefined,
  paths = path,
): string {
  const roots = [temporaryRoot];
  // Actions' runner.temp can be on a different filesystem from os.tmpdir().
  if (ci === "true" && runnerTemporaryRoot) roots.push(runnerTemporaryRoot);
  if (
    !directory ||
    !paths.isAbsolute(directory) ||
    !roots.some((root) => {
      if (!paths.isAbsolute(root)) return false;
      const child = paths.relative(root, directory);
      return (
        child !== "" &&
        child !== ".." &&
        !child.startsWith(`..${paths.sep}`) &&
        !paths.isAbsolute(child)
      );
    })
  )
    throw new Error(
      "Congress artifacts require an absolute owned temporary directory",
    );
  return paths.resolve(directory);
}
