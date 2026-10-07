import type { Metadata } from "next";

import { AUTH_FLOW_PAGE_TITLES } from "@ds/auth-flow/copy";
import { LoginRoute } from "@ds/auth-flow/login/route";

import { DOCTOR_AUTH_FLOW } from "../../../lib/auth-flow.host-config";

export const metadata: Metadata = {
  title: AUTH_FLOW_PAGE_TITLES.login,
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
