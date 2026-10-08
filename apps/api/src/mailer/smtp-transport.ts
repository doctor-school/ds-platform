import { connect as connectTcp, type Socket } from "node:net";
import { connect as connectTls } from "node:tls";
import { createTransport, type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import { ChannelRejection } from "./relay-channel.js";
import { classifySmtpError, type SmtpPhase } from "./smtp-outcome.js";
import type {
  SmtpSendOptions,
  SmtpTransport,
  SmtpTransportFactoryOptions,
  TransportFactory,
} from "./smtp-mailer.js";

/** 003 §14.3; absolute deadline includes DNS, TCP, TLS and final SMTP response. */
export interface SmtpDeadlines {
  connection: number;
  greeting: number;
  socket: number;
  absolute: number;
}
export const SMTP_DEADLINES: Readonly<SmtpDeadlines> = Object.freeze({
  connection: 5_000,
  greeting: 5_000,
  socket: 10_000,
  absolute: 15_000,
});

/** The owned-socket transport always offers the 003 EARS-46 probe. */
export type BoundedSmtpTransport = Required<SmtpTransport>;

export const boundedSmtpFactory: TransportFactory = (options) =>
  createBoundedSmtpTransport(options);

const END_OF_DATA = "\r\n.\r\n";

/**
 * Observes every byte written to the owned socket: once the `DATA` command is
 * written, the tail of the stream reveals the end-of-data sequence (dot
 * stuffing guarantees it cannot occur inside the body). 003 EARS-45.
 */
function trackPhase(socket: Socket): () => SmtpPhase {
  let dataCommand = false;
  let tail = "";
  let phase: SmtpPhase = "before-end-of-data";
  const write = socket.write.bind(socket) as (...args: unknown[]) => boolean;
  socket.write = ((chunk: unknown, ...rest: unknown[]) => {
    if (phase === "before-end-of-data") {
      const text = Buffer.isBuffer(chunk)
        ? chunk.toString("latin1")
        : typeof chunk === "string"
          ? chunk
          : chunk instanceof Uint8Array
            ? Buffer.from(chunk).toString("latin1")
            : undefined;
      if (text === undefined) phase = "unknown";
      else if (!dataCommand) {
        if (/^DATA\r\n$/i.test(text)) {
          dataCommand = true;
          tail = "\r\n";
        }
      } else {
        tail = (tail + text).slice(-END_OF_DATA.length);
        if (tail === END_OF_DATA) phase = "after-end-of-data";
      }
    }
    return write(chunk, ...rest);
  }) as Socket["write"];
  return () => phase;
}

/** Public getSocket ownership, one independent socket and terminal result per operation. */
export function createBoundedSmtpTransport(
  options: SmtpTransportFactoryOptions,
  deadlines: Readonly<SmtpDeadlines> = SMTP_DEADLINES,
): BoundedSmtpTransport {
  const run = (
    operation: (
      transport: Transporter,
      done: (error: unknown, info?: unknown) => void,
    ) => void,
    deadlineMs: number | undefined,
  ): Promise<unknown> =>
    new Promise((resolve, reject) => {
      let socket: Socket | undefined;
      let phase: () => SmtpPhase = () => "before-end-of-data";
      let terminal = false;
      let pendingHandoff: ((err: Error) => void) | undefined;
      let connectionTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error: unknown, info?: unknown) => {
        if (terminal) return;
        terminal = true;
        clearTimeout(absoluteTimer);
        clearTimeout(connectionTimer);
        // close() on SMTPTransport is insufficient for a per-send connection.
        // Destroy the actual socket even after acceptance, releasing all wire work.
        socket?.destroy();
        pendingHandoff?.(new Error("SMTP attempt finished"));
        pendingHandoff = undefined;
        if (error) reject(classifySmtpError(error, phase()));
        else resolve(info);
      };
      const timeout = () =>
        finish(
          new ChannelRejection(
            "timeout",
            "SMTP deadline exceeded",
            phase() === "before-end-of-data" ? "provider-failure" : "ambiguous",
          ),
        );
      const absolute = Math.max(
        0,
        Math.min(deadlines.absolute, deadlineMs ?? deadlines.absolute),
      );
      const absoluteTimer = setTimeout(timeout, absolute);
      const smtpOptions: SMTPTransport.Options = {
        ...options,
        connectionTimeout: deadlines.connection,
        greetingTimeout: deadlines.greeting,
        socketTimeout: deadlines.socket,
        // Real providers always use implicit TLS. Intercept is explicitly plaintext.
        ignoreTLS: !options.secure,
        tls: { rejectUnauthorized: true, servername: options.host },
        getSocket: (_opts, callback) => {
          if (terminal) {
            callback(new Error("SMTP attempt expired"), undefined);
            return;
          }
          let handedOff = false;
          pendingHandoff = (err) => {
            if (!handedOff) {
              handedOff = true;
              callback(err, undefined);
            }
          };
          const error = (err: Error) => {
            if (!handedOff) {
              handedOff = true;
              callback(err, undefined);
            }
            finish(err);
          };
          const connected = () => {
            clearTimeout(connectionTimer);
            if (terminal || handedOff) {
              socket?.destroy();
              return;
            }
            handedOff = true;
            pendingHandoff = undefined;
            callback(null, { connection: socket, secured: options.secure });
          };
          connectionTimer = setTimeout(
            timeout,
            Math.min(deadlines.connection, absolute),
          );
          socket = options.secure
            ? connectTls(
                {
                  host: options.host,
                  port: options.port,
                  servername: options.host,
                  rejectUnauthorized: true,
                },
                connected,
              )
            : connectTcp({ host: options.host, port: options.port }, connected);
          phase = trackPhase(socket);
          socket.on("error", error);
        },
      };
      try {
        operation(createTransport(smtpOptions), finish);
      } catch (error) {
        finish(error);
      }
    });
  return {
    sendMail(message, sendOptions?: SmtpSendOptions) {
      return run(
        (transport, done) => transport.sendMail(message, done),
        sendOptions?.deadlineMs,
      );
    },
    // 003 EARS-46: connect, greet and authenticate; no envelope is ever opened.
    async verify() {
      await run(
        (transport, done) =>
          transport.verify((error) => done(error ?? null, true)),
        undefined,
      );
    },
  };
}
