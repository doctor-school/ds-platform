import type { APIRequestContext } from "@playwright/test";

const LOGIN_SUBJECT = "код для входа в Doctor.School";
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface MailSummary {
  ID?: string;
  Created?: string;
  Subject?: string;
}

/** The slot and the shared inbox use the same stage DNS suffix and gate. */
export function mailpitUrlFor(hostBaseUrl: string): string {
  const url = new URL(hostBaseUrl);
  const [label, ...suffix] = url.hostname.split(".");
  if (!/^academy(?:-pr-\d+)?$/.test(label ?? "") || suffix.length < 2) {
    throw new Error(
      "Mailpit host cannot be derived from this Academy slot URL",
    );
  }
  url.hostname = ["mailpit", ...suffix].join(".");
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.origin;
}

export function selectLoginMail(
  messages: MailSummary[],
  afterIso: string,
): MailSummary | null {
  const after = Date.parse(afterIso);
  if (!Number.isFinite(after))
    throw new Error("Invalid login-code request time");
  return (
    messages
      .filter(
        (message) =>
          message.ID &&
          message.Created &&
          Date.parse(message.Created) >= after &&
          message.Subject?.includes(LOGIN_SUBJECT),
      )
      .sort((a, b) => Date.parse(b.Created!) - Date.parse(a.Created!))[0] ??
    null
  );
}

export function extractLoginCode(subject: string): string | null {
  return (
    subject.match(/^([0-9]{8})\s+—\s+код для входа в Doctor\.School$/)?.[1] ??
    null
  );
}

/** Read the delivered code; the API context inherits stage httpCredentials. */
export async function fetchLoginCode(
  request: APIRequestContext,
  baseUrl: string,
  email: string,
  afterIso: string,
): Promise<string> {
  const root = baseUrl.replace(/\/$/, "");
  for (let attempt = 0; attempt < 30; attempt++) {
    const search = await request.get(
      `${root}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    if (!search.ok()) {
      throw new Error(`Mailpit search failed with HTTP ${search.status()}`);
    }
    const list = (await search.json()) as { messages?: MailSummary[] };
    const hit = selectLoginMail(list.messages ?? [], afterIso);
    if (hit?.ID) {
      const detail = await request.get(
        `${root}/api/v1/message/${encodeURIComponent(hit.ID)}`,
      );
      if (!detail.ok()) {
        throw new Error(
          `Mailpit message read failed with HTTP ${detail.status()}`,
        );
      }
      const message = (await detail.json()) as { Subject?: string };
      const code = extractLoginCode(message.Subject ?? "");
      if (code) return code;
    }
    await wait(500);
  }
  throw new Error(
    "No delivered eight-digit login email code appeared in Mailpit",
  );
}
