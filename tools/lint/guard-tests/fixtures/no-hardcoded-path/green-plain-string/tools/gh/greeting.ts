// Fixture (GREEN): ordinary non-path string literals must NOT be flagged — no
// drive-letter root, no /home/<user> or /Users/<user> home root. A URL, a
// relative path, and a ternary that happens to contain a colon all pass clean.
export function greet(name: string): string {
  const docs = "https://doctor.school/docs";
  const rel = "apps/portal/src/page.tsx";
  const label = name ? "hi" : "bye";
  return `${label} ${name} — see ${docs} (${rel})`;
}
