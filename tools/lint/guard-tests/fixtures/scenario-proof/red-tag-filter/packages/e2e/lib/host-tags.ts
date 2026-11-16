// Fixture twin of packages/e2e/lib/host-tags.ts: the guard imports it for real.
export function tagExpressionFor(hostId: "academy" | "doctor"): string {
  return `@host:${hostId} or @host:both`;
}

export function signInHostTags(): string {
  return "@host:login and not @default-auth-limits";
}

export function ordinaryStorefrontTagsFor(expression: string): string {
  return `(${expression}) and not (@host:login and not @default-auth-limits)`;
}
