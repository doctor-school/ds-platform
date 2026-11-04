export function ownedDatabasePair(sourceUrl: string, targetUrl: string) {
  const source = new URL(sourceUrl),
    target = new URL(targetUrl);
  if (
    !/^\/ds_(dev|probe)_3688$/.test(source.pathname) ||
    target.pathname !== `${source.pathname}_novector`
  )
    throw new Error(
      "Only the exact #3688 source and new missing-vector DB pair is allowed",
    );
  const sourceName = source.pathname.slice(1),
    targetName = target.pathname.slice(1);
  source.pathname = target.pathname = "/";
  if (source.toString() !== target.toString())
    throw new Error("The copy must stay on the same server and account");
  return { source: sourceName, target: targetName };
}

export function withoutVector(toc: string) {
  const omitted: string[] = [];
  let extensions = 0;
  const list = toc
    .split("\n")
    .filter((line) => {
      if (!line.trim() || line.startsWith(";")) return true;
      const entry = line.match(/^\d+; \d+ \d+ (.*)$/)?.[1];
      if (!entry) throw new Error("Unexpected native pg_restore TOC format");
      if (
        /^(?:EXTENSION - vector|COMMENT - EXTENSION vector|ACL - EXTENSION vector(?: \S+)?)[ \r]*$/.test(
          entry,
        )
      ) {
        if (entry.startsWith("EXTENSION ")) extensions++;
        omitted.push(line);
        return false;
      }
      if (/vector/i.test(entry))
        throw new Error(`Unanticipated vector dependency: ${entry}`);
      return true;
    })
    .join("\n");
  if (extensions !== 1)
    throw new Error("Expected exactly one vector extension TOC entry");
  return { list, omitted };
}
