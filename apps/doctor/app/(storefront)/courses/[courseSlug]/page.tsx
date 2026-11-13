import { CoursePathPage } from "@ds/learning/ui";

import { DOCTOR_LEARNING } from "../../../../lib/learning.host-config";

/** 024 EARS-14 — the course path, per viewer (`private, no-store` reads). */
export const dynamic = "force-dynamic";

export default async function DoctorCoursePage({
  params,
}: {
  params: Promise<{ courseSlug: string }>;
}) {
  return <CoursePathPage config={DOCTOR_LEARNING} params={params} />;
}
