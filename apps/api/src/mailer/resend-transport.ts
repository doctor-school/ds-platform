import { emailSender } from "./email-layout.js";
import {
  ChannelRejection,
  type OutboundEmail,
  type RelayChannel,
} from "./relay-channel.js";
export const RESEND_API_URL = "https://api.resend.com/emails";
export const RESEND_DEADLINE_MS = 10_000;
export interface ResendChannelConfig {
  enabled?: boolean | undefined;
  apiKey: string;
  from?: string | undefined;
  fetchFn?: typeof fetch | undefined;
}
/** One bounded HTTP attempt. Raw responses never leave the adapter. */
export class ResendChannel implements RelayChannel {
  readonly provider = "resend";
  constructor(private readonly config: ResendChannelConfig) {}
  async send(message: OutboundEmail): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RESEND_DEADLINE_MS);
    let status: number | undefined;
    try {
      const response = await (this.config.fetchFn ?? fetch)(RESEND_API_URL, {
        method: "POST",
        signal: controller.signal,
        redirect: "error",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: emailSender(this.config.from),
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      });
      if (controller.signal.aborted) throw new Error("Request expired");
      status = response.status;
      if (status >= 200 && status <= 299) {
        // Acceptance is known from final headers; abort releases the unused body.
        return;
      }
      // Reading is bounded by the same abort signal, including error bodies.
      // Contents are deliberately discarded: they can echo recipient/OTP/secrets.
      await response.text();
      if (controller.signal.aborted) throw new Error("Request expired");
      if (status < 200 || status > 299)
        throw new ChannelRejection(String(status), "HTTP rejection");
    } catch {
      // A final HTTP status remains authoritative even if its body times out.
      if (status !== undefined && status >= 300 && status <= 599)
        throw new ChannelRejection(String(status), "HTTP rejection");
      throw new ChannelRejection(
        controller.signal.aborted ? "timeout" : "connection-failure",
        "HTTP acceptance unknown",
        "uncertain",
      );
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
}
