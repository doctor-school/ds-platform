import { LoginPage } from "@ds/auth-flow/login";

import { hostConfig } from "./host-config";
import { readSession } from "@/lib/session";

export default function DoctorLoginRoute() {
  return <LoginPage config={hostConfig} session={readSession} />;
}
