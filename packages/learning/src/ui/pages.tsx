import { headers } from "next/headers";
import { notFound } from "next/navigation";
import {
  type LearningCoursePath,
  forwardedHeaders,
  forwardedSessionFrom,
} from "@ds/schemas";

import {
  LearningClientError,
  createLearningClient,
  pointsPlateBalances,
  type LearningClient,
} from "../client/index";
import { CoursePath } from "./course-path";
import type { LearningHostConfig } from "./host-config";
import { StepScreen } from "./step-screen";

// 024 EARS-14 / EARS-15 — the server mounts of the course path and the step
// screen: the reads ride the doctor's forwarded session (ADR-0001 §6), an
// unknown course, lesson or step is the storefront's not-found page.

const API_BASE = (
  process.env.API_PROXY_TARGET ?? "http://localhost:3000"
).replace(/\/$/, "");

async function serverClient() {
  const session = forwardedSessionFrom(await headers());
  return createLearningClient({
    baseUrl: API_BASE,
    headers: forwardedHeaders(session),
  });
}

const isNotFound = (e: unknown) =>
  e instanceof LearningClientError && e.status === 404;

/**
 * EARS-14 — the 025 balances for the plate: null for a guest (dashes),
 * undefined when the read fails (no plate rather than a made-up number).
 */
async function plateBalances(client: LearningClient, signedIn: boolean) {
  if (!signedIn) return null;
  return client
    .myPoints()
    .then(pointsPlateBalances)
    .catch(() => undefined);
}

export async function CoursePathPage({
  config,
  params,
}: {
  config: LearningHostConfig;
  params: Promise<{ courseSlug: string }>;
}) {
  const { courseSlug } = await params;
  const client = await serverClient();
  let path: LearningCoursePath | null = null;
  try {
    path = await client.coursePath(courseSlug);
  } catch (e) {
    if (isNotFound(e)) notFound();
  }
  const points = path ? await plateBalances(client, path.signedIn) : undefined;
  return (
    <CoursePath
      courseSlug={courseSlug}
      config={config}
      initial={path}
      {...(points !== undefined ? { points } : {})}
    />
  );
}

export async function StepPage({
  config,
  params,
}: {
  config: LearningHostConfig;
  params: Promise<{ courseSlug: string; stepId: string }>;
}) {
  const { courseSlug, stepId } = await params;
  const client = await serverClient();
  let path: LearningCoursePath;
  try {
    path = await client.coursePath(courseSlug);
  } catch (e) {
    if (isNotFound(e)) notFound();
    throw e;
  }
  const lessonId = path.modules
    .flatMap((m) => m.lessons)
    .find((l) => l.steps.some((s) => s.id === stepId))?.id;
  if (!lessonId) notFound();
  const lesson = await client.lesson(lessonId);
  const node = lesson.steps.find((s) => s.id === stepId);
  const step =
    lesson.signedIn && node && node.state.status !== "locked"
      ? await client.step(stepId)
      : null;
  const points = await plateBalances(client, lesson.signedIn);
  return (
    <StepScreen
      courseSlug={courseSlug}
      config={config}
      lesson={lesson}
      stepId={stepId}
      step={step}
      {...(points !== undefined ? { points } : {})}
    />
  );
}
