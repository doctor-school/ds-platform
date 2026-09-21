import { LoginRoute } from "@ds/auth-flow/login/route";

import { ACADEMY_AUTH_FLOW } from "@/lib/auth-flow-config";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <LoginRoute config={ACADEMY_AUTH_FLOW} searchParams={searchParams} />;
}
