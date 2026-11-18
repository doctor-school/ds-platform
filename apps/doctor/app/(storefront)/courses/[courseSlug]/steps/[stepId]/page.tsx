import { StepPage } from "@ds/learning/ui";

import { DOCTOR_LEARNING } from "../../../../../../lib/learning.host-config";

/** 024 EARS-15 — one screen per step, per viewer (`private, no-store` reads). */
export const dynamic = "force-dynamic";

export default async function DoctorStepPage({
  params,
}: {
  params: Promise<{ courseSlug: string; stepId: string }>;
}) {
  return <StepPage config={DOCTOR_LEARNING} params={params} />;
}
