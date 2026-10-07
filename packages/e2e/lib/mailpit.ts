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
    subject.match(
      /^([A-Z0-9]{6})\s+—\s+код для входа в Doctor\.School$/,
    )?.[1] ?? null
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
    "No delivered six-character login email code appeared in Mailpit",
  );
}

const RESET_SUBJECT = " — код сброса пароля Doctor.School";
const DELIVERY_WINDOW_MS = 15_000;
interface AddressedMail extends MailSummary {
  To: { Address: string }[];
}

async function freshAddressedMail(
  request: APIRequestContext,
  baseUrl: string,
  email: string,
  afterIso: string,
): Promise<AddressedMail[]> {
  const after = Date.parse(afterIso);
  if (!Number.isFinite(after)) throw new Error("Invalid mail request time");
  const search = await request.get(
    `${baseUrl.replace(/\/$/, "")}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}&limit=1000`,
  );
  if (!search.ok())
    throw new Error(`Mailpit search failed with HTTP ${search.status()}`);
  const list = (await search.json()) as {
    messages?: AddressedMail[];
    messages_count?: number;
    start?: number;
  };
  // Mailpit's total counts the whole inbox; messages_count counts query matches.
  if (
    !list ||
    !Array.isArray(list.messages) ||
    !Number.isSafeInteger(list.messages_count) ||
    list.messages_count !== list.messages.length ||
    list.start !== 0
  ) {
    throw new Error("Invalid or incomplete Mailpit search payload");
  }
  for (const message of list.messages) {
    if (
      !message.ID ||
      !message.Created ||
      !Number.isFinite(Date.parse(message.Created)) ||
      !Array.isArray(message.To) ||
      message.To.some((recipient) => typeof recipient.Address !== "string")
    ) {
      throw new Error("Invalid Mailpit search payload");
    }
  }
  return list.messages.filter(
    (message) =>
      Date.parse(message.Created!) >= after &&
      message.To.some(
        (recipient) => recipient.Address.toLowerCase() === email.toLowerCase(),
      ),
  );
}

/** 003 EARS-11: prove fresh delivery without reading or logging the code. */
export async function waitForResetMail(
  request: APIRequestContext,
  baseUrl: string,
  email: string,
  afterIso: string,
): Promise<void> {
  const deadline = Date.now() + DELIVERY_WINDOW_MS;
  while (true) {
    const hit = (
      await freshAddressedMail(request, baseUrl, email, afterIso)
    ).find((message) => message.Subject?.endsWith(RESET_SUBJECT));
    if (hit) {
      const detail = await request.get(
        `${baseUrl.replace(/\/$/, "")}/api/v1/message/${encodeURIComponent(hit.ID!)}`,
      );
      if (!detail.ok())
        throw new Error(
          `Mailpit message read failed with HTTP ${detail.status()}`,
        );
      const message = (await detail.json()) as AddressedMail;
      if (
        !message.Subject?.endsWith(RESET_SUBJECT) ||
        !Array.isArray(message.To) ||
        !message.To.some(
          (recipient) =>
            recipient.Address.toLowerCase() === email.toLowerCase(),
        )
      ) {
        throw new Error(
          "Mailpit reset message did not match its addressed search result",
        );
      }
      return;
    }
    if (Date.now() >= deadline)
      throw new Error("No fresh addressed reset mail appeared in Mailpit");
    await wait(Math.min(500, deadline - Date.now()));
  }
}

/** 003 EARS-16: any addressed mail is a failure, over the full delivery horizon. */
export async function assertNoAddressedMail(
  request: APIRequestContext,
  baseUrl: string,
  email: string,
  afterIso: string,
): Promise<void> {
  const deadline = Date.now() + DELIVERY_WINDOW_MS;
  while (true) {
    if ((await freshAddressedMail(request, baseUrl, email, afterIso)).length) {
      throw new Error("Unexpected addressed mail after unknown reset request");
    }
    if (Date.now() >= deadline) return;
    await wait(Math.min(500, deadline - Date.now()));
  }
}

/** 003 EARS-12: codes stay in memory and must belong to the exact fresh delivery. */
export async function fetchRecoveryCode(
  request: APIRequestContext,
  baseUrl: string,
  email: string,
  afterIso: string,
  purpose: "register" | "reset",
): Promise<string> {
  const suffix =
    purpose === "reset" ? RESET_SUBJECT : " — код подтверждения Doctor.School";
  const deadline = Date.now() + DELIVERY_WINDOW_MS;
  while (true) {
    const hit = (
      await freshAddressedMail(request, baseUrl, email, afterIso)
    ).find(
      (message) =>
        typeof message.Subject === "string" && message.Subject.endsWith(suffix),
    );
    if (hit) {
      const detail = await request.get(
        `${baseUrl.replace(/\/$/, "")}/api/v1/message/${encodeURIComponent(hit.ID!)}`,
      );
      if (!detail.ok())
        throw new Error(
          `Mailpit message read failed with HTTP ${detail.status()}`,
        );
      // Detail exposes Date (sender header), not Created (inbox arrival);
      // freshness is established by the search result bound here by ID.
      const message = (await detail.json()) as AddressedMail | null;
      if (
        !message ||
        message.ID !== hit.ID ||
        message.Subject !== hit.Subject ||
        !Array.isArray(message.To) ||
        message.To.some(
          (recipient) => !recipient || typeof recipient.Address !== "string",
        ) ||
        !message.To.some(
          (recipient) =>
            recipient.Address.toLowerCase() === email.toLowerCase(),
        )
      ) {
        throw new Error(
          "Mailpit code detail did not match its fresh addressed search result",
        );
      }
      const code = message.Subject!.slice(0, -suffix.length);
      if (!/^\S+$/.test(code))
        throw new Error("Mailpit code subject is malformed");
      return code;
    }
    if (Date.now() >= deadline)
      throw new Error("No fresh addressed recovery code appeared in Mailpit");
    await wait(Math.min(500, deadline - Date.now()));
  }
}
