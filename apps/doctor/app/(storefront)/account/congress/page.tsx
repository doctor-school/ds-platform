import type { Metadata } from "next";

import { CongressSectionRoute } from "@ds/congress-submissions/route";

import { DOCTOR_AUTH_FLOW } from "../../../../lib/auth-flow.host-config";
import { DOCTOR_CONGRESS_SECTION } from "../../../../lib/congress-submissions.host-config";

/**
 * 046 EARS-4 — `doctor.school/account/congress`, «Мои заявки на Конгресс»: the
 * route-file mount of the shared `@ds/congress-submissions` section inside the
 * storefront shell. The guest decision and the return target live in the
 * package route; this file hands it the host's two configs.
 *
 * Registered `deferred` in `tools/lint/prod-surface-manifest.yaml` with the
 * rest of the doctor storefront, which opens with #1430.
 */
export const metadata: Metadata = {
  title: "Мои заявки на Конгресс — Doctor.School",
  description:
    "Заявки на доклады Конгресса: черновики, отправка в программный комитет и статусы рассмотрения.",
};

export default async function DoctorCongressSubmissionsPage() {
  return (
    <CongressSectionRoute
      auth={DOCTOR_AUTH_FLOW}
      host={DOCTOR_CONGRESS_SECTION}
    />
  );
}
