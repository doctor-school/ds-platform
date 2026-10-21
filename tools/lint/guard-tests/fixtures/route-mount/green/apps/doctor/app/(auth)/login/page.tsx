import type { Metadata } from "next";

import { AUTH_FLOW_PAGE_TITLES } from "@ds/auth-flow/copy";
import { LoginPage } from "@ds/auth-flow/login";

import { hostConfig } from "./host-config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: AUTH_FLOW_PAGE_TITLES.login,
  description: "Вход для врача: по паролю или по одноразовому коду.",
};

export default function DoctorLoginRoute() {
  return <LoginPage config={hostConfig} />;
}
