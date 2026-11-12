import { randomUUID } from "node:crypto";

function prefix(database: string): string {
  // Allowed database names are ASCII; leave room for the full UUID in PostgreSQL's 63 bytes.
  return `points-${database.slice(0, 19)}-`;
}

export function pointsApplicationName(database: string): string {
  return prefix(database) + randomUUID();
}

export function isPointsApplicationName(
  database: string,
  name: string,
): boolean {
  const expectedPrefix = prefix(database);
  return (
    Buffer.byteLength(name) <= 63 &&
    name.startsWith(expectedPrefix) &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      name.slice(expectedPrefix.length),
    )
  );
}
