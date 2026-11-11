import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect } from "@playwright/test";

type Row = Record<string, unknown>;
export const backfillTitles = [
  "A published event that never went live is refused",
  "A legacy event is not a backfill target",
  "The dry-run reports without mutating",
] as const;
export type BackfillEntry = {
  event: string;
  kind: string;
  outcome: string;
  code?: string;
  recordingId?: string;
};
export type BackfillSnapshot = {
  events: Row[];
  recordings: Row[];
  audit: Row[];
};
export type BackfillReceipt = {
  title: string;
  actor: string;
  database: string;
  manifest: {
    event: string;
    edited: { provider: string; embed_ref: string };
  }[];
  command: {
    entrypoint: string;
    args: string[];
    exitCode: number;
    stdout: string;
    stderr: string;
  };
  dryRun: boolean;
  statusMap: Record<string, number>;
  before: BackfillSnapshot;
  after: BackfillSnapshot;
};
export function readBackfillOutput(stdout: string) {
  const diagnostics: string[] = [];
  const lines = stdout
    .trim()
    .split(/\r?\n/)
    .filter((line) => {
      if (
        /^\[Nest\] \d+\s+- .+ WARN \[(SessionAuthHook|AdminSessionAuthHook)\] no Fastify instance — (session|admin) auth hook not registered$/.test(
          line,
        )
      ) {
        diagnostics.push(line);
        return false;
      }
      if (line.startsWith("[delivery-reconcile] ")) {
        const diagnostic = JSON.parse(
          line.slice("[delivery-reconcile] ".length),
        );
        expect(diagnostic.event).toBe("delivery_mail_readiness");
        expect(Array.isArray(diagnostic.channels)).toBe(true);
        expect(Array.isArray(diagnostic.operational_reserve)).toBe(true);
        expect(Object.keys(diagnostic).sort()).toEqual([
          "channels",
          "event",
          "operational_reserve",
        ]);
        diagnostics.push(line);
        return false;
      }
      return true;
    })
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const final = lines.pop()!;
  expect(typeof final.dryRun).toBe("boolean");
  expect(final.summary).toBeDefined();
  return { entries: lines as unknown as BackfillEntry[], final, diagnostics };
}
// 014 EARS-29: the CLI reports domain codes; no HTTP response is invented.
export function assertBackfillReceipt(r: BackfillReceipt, title: string) {
  expect(r).toBeDefined();
  expect(r.title).toBe(title);
  expect(r.actor.length).toBeGreaterThan(2);
  expect(r.database).toMatch(/^ds_(dev_3939|admin_e2e)$/);
  expect(r.command.entrypoint).toBe("apps/api/scripts/recordings-backfill.ts");
  expect(r.command.exitCode).toBe(0);
  expect(r.command.args).toContain("--manifest");
  expect(r.command.args[r.command.args.indexOf("--actor") + 1]).toBe(r.actor);
  expect(r.command.args.includes("--dry-run")).toBe(r.dryRun);
  const { entries, final } = readBackfillOutput(r.command.stdout);
  expect(final.dryRun).toBe(r.dryRun);
  expect(entries.map((e) => e.event)).toEqual(r.manifest.map((m) => m.event));
  expect(entries.every((e) => e.kind === "edited")).toBe(true);
  const summary = Object.fromEntries(
    [
      "attached+published",
      "published",
      "skipped",
      "would-attach",
      "refused",
    ].map((outcome) => [
      outcome,
      entries.filter((e) => e.outcome === outcome).length,
    ]),
  );
  expect(final.summary).toEqual(summary);
  expect(r.after.events).toEqual(r.before.events);
  const target = r.before.events.find((e) => e.id === r.manifest[0]!.event)!;
  expect(target).toBeDefined();
  if (title === backfillTitles[0]) {
    expect(r.dryRun).toBe(false);
    expect(entries.map((e) => e.outcome)).toEqual([
      "refused",
      "attached+published",
    ]);
    expect(entries[0]!.code).toBe("EVENT_NOT_FINISHED");
    expect(r.statusMap.EVENT_NOT_FINISHED).toBe(409);
    expect(target).toMatchObject({
      origin: "platform",
      state: "published",
      live_at: null,
    });
    expect(Date.parse(target.starts_at as string)).toBeLessThan(Date.now());
    expect(r.before.recordings.filter((e) => e.event_id === target.id)).toEqual(
      [],
    );
    expect(r.after.recordings.filter((e) => e.event_id === target.id)).toEqual(
      [],
    );
    const eligible = r.before.events.find(
      (e) => e.id === r.manifest[1]!.event,
    )!;
    expect(eligible).toMatchObject({ origin: "platform", state: "ended" });
    const newRows = r.after.recordings.filter(
      (e) => !r.before.recordings.some((b) => b.id === e.id),
    );
    expect(newRows).toHaveLength(1);
    expect(newRows[0]).toMatchObject({
      id: entries[1]!.recordingId,
      event_id: eligible.id,
      kind: "edited",
      status: "published",
    });
    const addedAudits = r.after.audit.filter(
      (e) => !r.before.audit.some((b) => b.id === e.id),
    );
    expect(addedAudits).toHaveLength(2);
    expect(addedAudits.map((e) => e.event_type).sort()).toEqual([
      "data.event_recordings.insert",
      "data.event_recordings.update",
    ]);
    for (const audit of addedAudits)
      expect(audit).toMatchObject({
        subject_id: r.actor,
        metadata: {
          source: "system:recordings-backfill",
          table: "event_recordings",
          pk: { id: entries[1]!.recordingId },
        },
      });
  } else if (title === backfillTitles[1]) {
    expect(r.dryRun).toBe(false);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      outcome: "refused",
      code: "INVALID_TRANSITION",
    });
    expect(r.statusMap.INVALID_TRANSITION).toBe(409);
    expect(target).toMatchObject({ origin: "legacy", state: "hidden" });
    expect(r.before.recordings.filter((e) => e.event_id === target.id)).toEqual(
      [],
    );
    expect(r.after).toEqual(r.before);
  } else {
    expect(title).toBe(backfillTitles[2]);
    expect(r.dryRun).toBe(true);
    expect(entries.map((e) => e.outcome)).toEqual([
      "would-attach",
      "skipped",
      "refused",
    ]);
    expect(entries[2]!.code).toBe("EVENT_NOT_FINISHED");
    expect(r.statusMap.EVENT_NOT_FINISHED).toBe(409);
    for (const [index, state] of ["ended", "ended", "published"].entries()) {
      const fixture = r.before.events.find(
        (e) => e.id === r.manifest[index]!.event,
      )!;
      expect(fixture).toMatchObject({ origin: "platform", state });
      const rows = r.before.recordings.filter((e) => e.event_id === fixture.id);
      if (index === 1) {
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          id: entries[1]!.recordingId,
          kind: "edited",
          status: "published",
          deleted_at: null,
        });
      } else expect(rows).toEqual([]);
    }
    expect(r.after).toEqual(r.before);
  }
}

export async function captureBackfillCommand(
  directory: string,
  run: () => Promise<{ stdout: string; stderr: string }>,
) {
  try {
    const result = await run();
    await Promise.all([
      writeFile(resolve(directory, "stdout.jsonl"), result.stdout),
      writeFile(resolve(directory, "stderr.log"), result.stderr),
      writeFile(
        resolve(directory, "process.json"),
        JSON.stringify({ status: "completed", exitCode: 0 }),
      ),
    ]);
    return result;
  } catch (error) {
    const result = error as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      signal?: string;
    };
    await Promise.all([
      writeFile(resolve(directory, "stdout.jsonl"), result.stdout ?? ""),
      writeFile(resolve(directory, "stderr.log"), result.stderr ?? ""),
      writeFile(
        resolve(directory, "process.json"),
        JSON.stringify({
          status: "failed",
          exitCode: result.code ?? null,
          signal: result.signal ?? null,
        }),
      ),
    ]);
    throw error;
  }
}
