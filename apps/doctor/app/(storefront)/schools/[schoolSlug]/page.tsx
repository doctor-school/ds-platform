import { SchoolPage } from "@ds/learning/ui";

import { DOCTOR_LEARNING } from "../../../../lib/learning.host-config";

/** 023 EARS-4 — the school screen, per viewer (`private, no-store` reads). */
export const dynamic = "force-dynamic";

export default async function DoctorSchoolPage({
  params,
}: {
  params: Promise<{ schoolSlug: string }>;
}) {
  return <SchoolPage config={DOCTOR_LEARNING} params={params} />;
}
