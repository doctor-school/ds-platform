import { createServer, type Socket } from "node:net";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { createBoundedSmtpTransport } from "./smtp-transport.js";

const message = {
  from: "sender@example.com",
  to: "doctor@example.com",
  subject: "test",
  text: "test",
  html: "test",
};

type Mode =
  | "stall"
  | "drip"
  | "data-stall"
  | "accept"
  | "reject"
  | "rcpt-unknown"
  | "rcpt-stall"
  | "drop-before-data"
  | "drop-after-eod"
  | "auth-fail";

async function smtpServer(mode: Mode) {
  const sockets = new Set<Socket>();
  const commands: string[] = [];
  let accepted = 0;
  let dataStarted = 0;
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    if (mode === "stall") {
      socket.resume();
      return;
    }
    if (mode === "drip") {
      const timer = setInterval(
        () => socket.write("220-partial greeting\r\n"),
        5,
      );
      socket.on("close", () => clearInterval(timer));
      return;
    }
    socket.write("220 local SMTP\r\n");
    let buffer = "";
    let data = false;
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      while (buffer.includes("\r\n")) {
        const at = buffer.indexOf("\r\n");
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        if (data) {
          if (line === ".") {
            data = false;
            if (mode === "drop-after-eod") socket.destroy();
            else if (mode !== "data-stall") {
              accepted++;
              socket.write("250 2.0.0 accepted\r\n");
            }
          }
          continue;
        }
        commands.push(line.split(" ")[0]!);
        if (line.startsWith("EHLO"))
          socket.write("250-local\r\n250 AUTH PLAIN\r\n");
        else if (line.startsWith("AUTH"))
          socket.write(
            mode === "auth-fail"
              ? "535 5.7.8 authentication failed\r\n"
              : "235 2.7.0 ok\r\n",
          );
        else if (line.startsWith("MAIL") && mode === "drop-before-data")
          socket.destroy();
        else if (line.startsWith("RCPT") && mode === "reject")
          socket.write("550 rejected\r\n");
        else if (line.startsWith("RCPT") && mode === "rcpt-unknown")
          socket.write("550 5.1.1 doctor@example.com unknown\r\n");
        else if (line.startsWith("RCPT") && mode === "rcpt-stall") continue;
        else if (line === "DATA") {
          data = true;
          dataStarted++;
          socket.write("354 proceed\r\n");
        } else if (line === "QUIT") socket.end("221 bye\r\n");
        else socket.write("250 ok\r\n");
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  return {
    port,
    sockets,
    commands,
    accepted: () => accepted,
    dataStarted: () => dataStarted,
    close: async () => {
      for (const s of sockets) s.destroy();
      server.close();
      await once(server, "close");
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const fast = { absolute: 300, connection: 100, greeting: 150, socket: 300 };

describe("owned SMTP deadline", () => {
  it("EARS-45: stalled greeting and drip-fed responses terminate before end-of-data as provider-failure and destroy their sockets", async () => {
    for (const mode of ["stall", "drip"] as const) {
      const server = await smtpServer(mode);
      try {
        const transport = createBoundedSmtpTransport(
          { host: "127.0.0.1", port: server.port, secure: false },
          { absolute: 100, connection: 50, greeting: 300, socket: 300 },
        );
        await expect(transport.sendMail(message)).rejects.toMatchObject({
          outcome: "provider-failure",
          code: "timeout",
        });
        await settle();
        expect(server.sockets.size).toBe(0);
      } finally {
        await server.close();
      }
    }
  });
  it("EARS-45: timeout after the end-of-data sequence is ambiguous and cannot become late acceptance", async () => {
    const server = await smtpServer("data-stall");
    try {
      const transport = createBoundedSmtpTransport(
        { host: "127.0.0.1", port: server.port, secure: false },
        { absolute: 200, connection: 50, greeting: 100, socket: 300 },
      );
      await expect(transport.sendMail(message)).rejects.toMatchObject({
        outcome: "ambiguous",
      });
      expect(server.dataStarted()).toBe(1);
      await settle();
      expect(server.sockets.size).toBe(0);
      expect(server.accepted()).toBe(0);
    } finally {
      await server.close();
    }
  });
  it("EARS-45: a timeout waiting for the RCPT TO reply is provider-failure (end-of-data never written)", async () => {
    const server = await smtpServer("rcpt-stall");
    try {
      const transport = createBoundedSmtpTransport(
        { host: "127.0.0.1", port: server.port, secure: false },
        fast,
      );
      await expect(transport.sendMail(message)).rejects.toMatchObject({
        outcome: "provider-failure",
        code: "timeout",
      });
      expect(server.dataStarted()).toBe(0);
    } finally {
      await server.close();
    }
  });
  it("EARS-45: connection loss before DATA is provider-failure; after end-of-data it is ambiguous", async () => {
    for (const [mode, outcome] of [
      ["drop-before-data", "provider-failure"],
      ["drop-after-eod", "ambiguous"],
    ] as const) {
      const server = await smtpServer(mode);
      try {
        const transport = createBoundedSmtpTransport(
          { host: "127.0.0.1", port: server.port, secure: false },
          fast,
        );
        await expect(transport.sendMail(message)).rejects.toMatchObject({
          outcome,
        });
      } finally {
        await server.close();
      }
    }
  });
  it("EARS-45: an enhanced 5.1.1 RCPT TO reply is recipient-permanent and a bare 550 is provider-failure", async () => {
    for (const [mode, outcome, code] of [
      ["rcpt-unknown", "recipient-permanent", "550 5.1.1"],
      ["reject", "provider-failure", "550"],
    ] as const) {
      const server = await smtpServer(mode);
      try {
        const transport = createBoundedSmtpTransport(
          { host: "127.0.0.1", port: server.port, secure: false },
          fast,
        );
        const err = await transport.sendMail(message).catch((e: unknown) => e);
        expect(err).toMatchObject({ outcome, code });
        expect(JSON.stringify(err)).not.toContain("doctor@example.com");
      } finally {
        await server.close();
      }
    }
  });
  it("EARS-31: the effective deadline is the lesser of the channel deadline and the remaining budget", async () => {
    const server = await smtpServer("stall");
    try {
      const transport = createBoundedSmtpTransport(
        { host: "127.0.0.1", port: server.port, secure: false },
        { absolute: 5_000, connection: 5_000, greeting: 5_000, socket: 5_000 },
      );
      const started = Date.now();
      await expect(
        transport.sendMail(message, { deadlineMs: 80 }),
      ).rejects.toMatchObject({ code: "timeout" });
      expect(Date.now() - started).toBeLessThan(2_000);
      await settle();
      expect(server.sockets.size).toBe(0);
    } finally {
      await server.close();
    }
  });
  it("EARS-31: concurrent sends own isolated sockets and release successful and rejected attempts", async () => {
    for (const mode of ["accept", "reject"] as const) {
      const server = await smtpServer(mode);
      try {
        const transport = createBoundedSmtpTransport({
          host: "127.0.0.1",
          port: server.port,
          secure: false,
        });
        const results = await Promise.allSettled([
          transport.sendMail(message),
          transport.sendMail(message),
        ]);
        expect(
          results.every(
            (r) => r.status === (mode === "accept" ? "fulfilled" : "rejected"),
          ),
        ).toBe(true);
        await settle();
        expect(server.sockets.size).toBe(0);
        expect(server.accepted()).toBe(mode === "accept" ? 2 : 0);
      } finally {
        await server.close();
      }
    }
  });
  it("EARS-31: a stalled implicit TLS handshake is cancelled before socket handoff", async () => {
    const server = await smtpServer("stall");
    try {
      const transport = createBoundedSmtpTransport(
        { host: "127.0.0.1", port: server.port, secure: true },
        { absolute: 200, connection: 50, greeting: 100, socket: 100 },
      );
      await expect(transport.sendMail(message)).rejects.toMatchObject({
        outcome: "provider-failure",
        code: "timeout",
      });
      await settle();
      expect(server.sockets.size).toBe(0);
    } finally {
      await server.close();
    }
  });
});

describe("003 EARS-46 SMTP readiness probe", () => {
  it("EARS-46: verify performs an authenticated handshake and never issues MAIL FROM, RCPT TO or DATA", async () => {
    const server = await smtpServer("accept");
    try {
      const transport = createBoundedSmtpTransport(
        {
          host: "127.0.0.1",
          port: server.port,
          secure: false,
          auth: { user: "id", pass: "secret" },
        },
        fast,
      );
      await expect(transport.verify()).resolves.toBeUndefined();
      expect(server.commands).toContain("AUTH");
      expect(server.commands).not.toContain("MAIL");
      expect(server.commands).not.toContain("RCPT");
      expect(server.dataStarted()).toBe(0);
      await settle();
      expect(server.sockets.size).toBe(0);
    } finally {
      await server.close();
    }
  });
  it("EARS-46: an authentication failure or a stalled server fails the probe and releases the socket", async () => {
    for (const mode of ["auth-fail", "stall"] as const) {
      const server = await smtpServer(mode);
      try {
        const transport = createBoundedSmtpTransport(
          {
            host: "127.0.0.1",
            port: server.port,
            secure: false,
            auth: { user: "id", pass: "secret" },
          },
          fast,
        );
        await expect(transport.verify()).rejects.toBeDefined();
        await settle();
        expect(server.sockets.size).toBe(0);
      } finally {
        await server.close();
      }
    }
  });
});
