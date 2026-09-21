import type { Metadata } from "next";

import { LoginRoute } from "@ds/auth-flow/login/route";

import { DOCTOR_AUTH_FLOW } from "@/lib/auth-flow-config";

export const metadata: Metadata = {
  title: "Вход — Doctor.School",
  description:
    "Вход для врача на Doctor.School: по паролю или по одноразовому коду на почту или в СМС.",
};

export default async function DoctorLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <LoginRoute config={DOCTOR_AUTH_FLOW} searchParams={searchParams} />;
}
