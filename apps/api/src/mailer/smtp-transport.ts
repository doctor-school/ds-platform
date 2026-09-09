import { connect as connectTcp, type Socket } from "node:net";
import { connect as connectTls } from "node:tls";
import { createTransport } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import { ChannelRejection } from "./relay-channel.js";
import type {
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

export const boundedSmtpFactory: TransportFactory = (options) =>
  createBoundedSmtpTransport(options);

/** Public getSocket ownership, one independent socket and terminal result per send. */
export function createBoundedSmtpTransport(
  options: SmtpTransportFactoryOptions,
  deadlines: Readonly<SmtpDeadlines> = SMTP_DEADLINES,
): SmtpTransport {
  return {
    sendMail(message) {
      return new Promise((resolve, reject) => {
        let socket: Socket | undefined;
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
          if (error) reject(error);
          else resolve(info);
        };
        const timeout = () =>
          finish(
            new ChannelRejection(
              "timeout",
              "SMTP deadline exceeded",
              "uncertain",
            ),
          );
        const absoluteTimer = setTimeout(timeout, deadlines.absolute);
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
            connectionTimer = setTimeout(timeout, deadlines.connection);
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
              : connectTcp(
                  { host: options.host, port: options.port },
                  connected,
                );
            socket.on("error", error);
          },
        };
        try {
          createTransport(smtpOptions).sendMail(message, (error, info) =>
            finish(error, info),
          );
        } catch (error) {
          finish(error);
        }
      });
    },
  };
}
