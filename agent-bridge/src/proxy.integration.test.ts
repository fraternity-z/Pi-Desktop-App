import { createServer } from "node:http";
import { connect, type Socket } from "node:net";
import { once } from "node:events";
import { getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { expect, it } from "vitest";
import { configureProxy } from "./proxy.js";

it("routes built-in fetch through a local CONNECT proxy and honors bypass and direct modes", async () => {
  const original = getGlobalDispatcher();
  const origin = createServer((_request, response) =>
    response.end("fixture response"),
  );
  const proxy = createServer();
  const sockets = new Set<Socket>();
  let connections = 0;
  for (const server of [origin, proxy]) {
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
  }
  const originPort = (origin.address() as { port: number }).port;
  const proxyPort = (proxy.address() as { port: number }).port;
  proxy.on("connect", (_request, socket, head) => {
    connections += 1;
    const upstream = connect(originPort, "127.0.0.1", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    sockets.add(upstream);
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });
  try {
    const target = `http://127.0.0.1:${originPort}/fixture`;
    for (const [mode, bypass, expectedConnections] of [
      ["custom", "", 1],
      ["custom", "127.0.0.1", 1],
      ["direct", "", 1],
    ] as const) {
      configureProxy({
        PI_DESKTOP_PROXY_MODE: mode,
        PI_DESKTOP_PROXY_URL: `http://127.0.0.1:${proxyPort}`,
        PI_DESKTOP_NO_PROXY: bypass,
      });
      const dispatcher = getGlobalDispatcher();
      try {
        const response = await fetch(target, {
          signal: AbortSignal.timeout(3000),
        });
        expect(await response.text()).toBe("fixture response");
        expect(connections).toBe(expectedConnections);
      } finally {
        await dispatcher.destroy();
      }
    }
  } finally {
    setGlobalDispatcher(original);
    for (const socket of sockets) socket.destroy();
    await Promise.all([
      new Promise<void>((resolve) => origin.close(() => resolve())),
      new Promise<void>((resolve) => proxy.close(() => resolve())),
    ]);
  }
});
