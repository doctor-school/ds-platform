const owners: Record<string, string> = {
  "window-names": "3974",
  "repeat-consent-price": "3979",
  intake: "3981",
};

export function congressOwner(
  group = "window-names",
  requested?: string,
): string {
  const owner = owners[group];
  if (!owner || (requested && requested !== owner && requested !== "3981"))
    throw new Error("Unknown congress group or unrelated resource owner");
  return requested ?? owner;
}

export function assertCongressDatabase(
  url: string | undefined,
  expected: string | undefined,
  owner: string,
  ci?: string,
): void {
  if (
    !["3974", "3979", "3981"].includes(owner) ||
    !url ||
    !(
      expected === `ds_dev_${owner}` ||
      (ci === "true" && expected === "ds_test")
    ) ||
    new URL(url).pathname !== `/${expected}`
  )
    throw new Error(
      "Congress requires its exact owned database or disposable CI ds_test",
    );
}
