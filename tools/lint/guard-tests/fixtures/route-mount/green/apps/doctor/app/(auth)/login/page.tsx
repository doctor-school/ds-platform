import type { Metadata } from "next";

import { LoginPage } from "@ds/auth-flow/login";

import { hostConfig } from "./host-config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Вход" };

export default function DoctorLoginRoute() {
  return <LoginPage config={hostConfig} />;
}
