import { vi } from "vitest";
import type { LearningSchoolRead } from "@ds/schemas";

/** 023 EARS-6 — the read of a published school with no published course. */
export function soonSchool(read: LearningSchoolRead): LearningSchoolRead {
  return {
    ...read,
    school: {
      ...read.school,
      status: "soon",
      soonNote: "Первые курсы готовим вместе с экспертами",
      courseCount: 0,
      lessonCount: 0,
    },
    courses: [],
  };
}

/**
 * 023 EARS-7 — stub the interest writes: each `METHOD url` answers the
 * interest in that state, or fails with the given HTTP status.
 */
export function schoolInterestFetch(
  routes: Record<string, "active" | "withdrawn" | number>,
) {
  const seen: string[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    seen.push(key);
    const v = routes[key];
    if (v === undefined) return new Response("{}", { status: 404 });
    if (typeof v === "number") return new Response("{}", { status: v });
    return new Response(
      JSON.stringify({
        schoolId: url.split("/")[5],
        state: v,
        registeredAt: "2026-11-24T10:00:00.000Z",
        withdrawnAt: v === "withdrawn" ? "2026-11-24T10:05:00.000Z" : null,
      }),
      { status: 200 },
    );
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls: () => [...seen] };
}
