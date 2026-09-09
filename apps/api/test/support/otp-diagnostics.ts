/** Test-only evidence: retain categories and booleans, never provider payloads. */
export function diagnosticFetch(
  fetchImpl: typeof fetch,
  records: unknown[],
): typeof fetch {
  return async (input, init) => {
    const path = new URL(String(input)).pathname;
    const route =
      path === "/v2/sessions"
        ? "sessions"
        : path === "/v2/users"
          ? "user-search"
          : path.endsWith("/otp_email")
            ? "email-factor"
            : path.endsWith("/otp_sms")
              ? "sms-factor"
              : "other";
    const method =
      init?.method === "POST"
        ? "POST"
        : init?.method === "GET" || !init?.method
          ? "GET"
          : "other";
    const record: Record<string, unknown> = { method, route, status: 0 };
    // Bound retention even when the projection helper polls repeatedly.
    if (records.length < 100) records.push(record);
    const response = await fetchImpl(input, init);
    record.status = response.status;
    if (
      route === "sessions" ||
      route === "user-search" ||
      route.endsWith("factor")
    ) {
      try {
        const body = (await response.clone().json()) as Record<string, unknown>;
        if (route === "user-search" && Array.isArray(body.result))
          record.userMatches = body.result.length;
        if (
          typeof body.code === "number" &&
          Number.isInteger(body.code) &&
          body.code >= 0 &&
          body.code <= 16
        )
          record.code = body.code;
        record.sessionPresent =
          typeof body.sessionId === "string" && body.sessionId.length > 0;
        record.sessionTokenPresent =
          typeof body.sessionToken === "string" && body.sessionToken.length > 0;
      } catch {
        /* Diagnostic parsing must not alter adapter behavior. */
      }
    }
    return response;
  };
}

export function mailboxSnapshot(
  messages: Array<{
    Created?: string;
    Subject?: string;
    [key: string]: unknown;
  }>,
  after: number,
  subject?: string,
) {
  const fresh = (m: { Created?: string }) =>
    !!m.Created && Date.parse(m.Created) >= after;
  const matches = (m: { Subject?: string }) =>
    !subject || (m.Subject ?? "").includes(subject);
  return {
    messages: messages.length,
    fresh: messages.filter(fresh).length,
    subjectMatches: messages.filter(matches).length,
    eligible: messages.filter((m) => fresh(m) && matches(m)).length,
  };
}
