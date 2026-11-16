// A tag helper outside the guard's allowlist: the guard must not run it.
export function otherTags(): string {
  return "@host:admin";
}
