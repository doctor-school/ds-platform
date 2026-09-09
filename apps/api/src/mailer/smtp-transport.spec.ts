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

async function smtpServer(
  mode: "stall" | "drip" | "data-stall" | "accept" | "reject",
) {
  const sockets = new Set<Socket>();
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
            if (mode !== "data-stall") {
              accepted++;
              socket.write("250 accepted\r\n");
            }
          }
        } else if (line.startsWith("EHLO")) socket.write("250 local\r\n");
        else if (line.startsWith("RCPT") && mode === "reject")
          socket.write("550 rejected\r\n");
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
    accepted: () => accepted,
    dataStarted: () => dataStarted,
    close: async () => {
      for (const s of sockets) s.destroy();
      server.close();
      await once(server, "close");
    },
  };
}

describe("owned SMTP deadline", () => {
  it("EARS-31: stalled greeting and drip-fed responses terminate and destroy their sockets", async () => {
    for (const mode of ["stall", "drip"] as const) {
      const server = await smtpServer(mode);
      try {
        const transport = createBoundedSmtpTransport(
          { host: "127.0.0.1", port: server.port, secure: false },
          { absolute: 100, connection: 50, greeting: 300, socket: 300 },
        );
        await expect(transport.sendMail(message)).rejects.toMatchObject({
          outcome: "uncertain",
          code: "timeout",
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(server.sockets.size).toBe(0);
      } finally {
        await server.close();
      }
    }
  });
  it("EARS-31: timeout after DATA remains uncertain and cannot become late acceptance", async () => {
    const server = await smtpServer("data-stall");
    try {
      const transport = createBoundedSmtpTransport(
        { host: "127.0.0.1", port: server.port, secure: false },
        { absolute: 200, connection: 50, greeting: 100, socket: 300 },
      );
      await expect(transport.sendMail(message)).rejects.toMatchObject({
        outcome: "uncertain",
      });
      expect(server.dataStarted()).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(server.sockets.size).toBe(0);
      expect(server.accepted()).toBe(0);
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
        await new Promise((resolve) => setTimeout(resolve, 20));
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
        outcome: "uncertain",
        code: "timeout",
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(server.sockets.size).toBe(0);
    } finally {
      await server.close();
    }
  });
});
