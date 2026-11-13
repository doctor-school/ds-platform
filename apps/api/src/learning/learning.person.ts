import { UnauthorizedException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { type DrizzleHandle, users } from "@ds/db";
import { and, eq, isNull } from "drizzle-orm";

// 024 — the doctor is always the session subject's live `users.id`; no learning
// route takes a person identifier (the same rule as `/v1/me/points`, 025).

type Db = DrizzleHandle["db"];

function subOf(req: FastifyRequest): string | undefined {
  return (req as { user?: { sub?: string } }).user?.sub;
}

async function personOf(db: Db, sub: string): Promise<string | null> {
  const [person] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.zitadelSub, sub), isNull(users.deactivatedAt)));
  return person?.id ?? null;
}

/** A public read: the signed-in doctor's person, or null for a guest. */
export async function optionalPersonId(
  db: Db,
  req: FastifyRequest,
): Promise<string | null> {
  const sub = subOf(req);
  return sub ? personOf(db, sub) : null;
}

/** A `/v1/me/learning/*` route: the caller's person, 401 otherwise (EARS-22). */
export async function callerPersonId(
  db: Db,
  req: FastifyRequest,
): Promise<string> {
  const sub = subOf(req);
  const id = sub ? await personOf(db, sub) : null;
  if (!id) throw new UnauthorizedException("authentication required");
  return id;
}
