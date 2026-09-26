import { lookup } from "node:dns/promises";
import { once } from "node:events";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import {
  EnvHttpProxyAgent,
  MockAgent,
  getGlobalDispatcher,
  interceptors,
  setGlobalDispatcher,
  type buildConnector,
} from "undici";
import {
  isPublicAddress,
  NetworkPolicyError,
  strictDnsLookup,
  strictNetworkAgentFactory,
  validateStrictOrigin,
} from "./network-policy.js";
import { configureProxy } from "./proxy.js";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

describe("strict network policy", () => {
  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.31.0.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.19.255.255",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "2002:a00:1::1",
    "invalid",
  ])("rejects nonpublic address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])(
    "allows public address %s",
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );
  it.each([
    "http://example.com",
    "https://localhost",
    "https://x.localhost.",
    "https://model.local",
    "https://127.1",
    "https://0x7f000001",
    "https://2130706433",
    "https://[::1]",
    "https://198.18.0.1",
    "https://private:secret@example.com",
    "invalid",
  ])("blocks unsafe origin without echoing %s", (origin) => {
    expect(() => validateStrictOrigin(origin)).toThrow(NetworkPolicyError);
    try {
      validateStrictOrigin(origin);
    } catch (error) {
      expect(String(error)).not.toContain("secret");
    }
  });
  it("accepts public HTTPS origins", () => {
    expect(() =>
      validateStrictOrigin(new URL("https://api.example.com:8443")),
    ).not.toThrow();
  });
  it("validates every DNS answer and sanitizes resolution errors", async () => {
    for (const addresses of [
      [],
      [
        { address: "8.8.8.8", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
    ]) {
      vi.mocked(lookup).mockResolvedValueOnce(addresses as never);
      await new Promise<void>((resolve) =>
        strictDnsLookup(
          new URL("https://api.example.com"),
          {},
          (error, records) => {
            expect(error).toBeInstanceOf(NetworkPolicyError);
            expect(records).toEqual([]);
            resolve();
          },
        ),
      );
    }
    vi.mocked(lookup).mockRejectedValueOnce(Error("private resolver"));
    await new Promise<void>((resolve) =>
      strictDnsLookup(new URL("https://api.example.com"), {}, (error) => {
        expect(String(error)).not.toContain("private resolver");
        resolve();
      }),
    );
    vi.mocked(lookup).mockResolvedValueOnce([
      { address: "8.8.8.8", family: 4 },
    ] as never);
    await new Promise<void>((resolve) =>
      strictDnsLookup(
        new URL("https://api.example.com"),
        {},
        (error, records) => {
          expect(error).toBeNull();
          expect(records[0]).toEqual({
            address: "8.8.8.8",
            family: 4,
            ttl: 60_000,
          });
          resolve();
        },
      ),
    );
  });
  it("handles IPv6 literals without attempting DNS", () => {
    const callback = vi.fn();
    strictDnsLookup(new URL("https://[2606:4700:4700::1111]"), {}, callback);
    expect(callback).toHaveBeenCalledWith(null, [
      { address: "2606:4700:4700::1111", family: 6, ttl: 60_000 },
    ]);
    strictDnsLookup(new URL("https://[::1]"), {}, callback);
    expect(callback).toHaveBeenLastCalledWith(
      expect.any(NetworkPolicyError),
      [],
    );
  });
  it("pins DNS to a reviewed public address and retains the Host header", async () => {
    const mock = new MockAgent();
    mock.disableNetConnect();
    mock
      .get("https://8.8.8.8")
      .intercept({
        path: "/",
        method: "GET",
        headers: { host: "api.example.com" },
      })
      .reply(200, "fixture");
    vi.mocked(lookup).mockResolvedValueOnce([
      { address: "8.8.8.8", family: 4 },
    ] as never);
    const dispatcher = mock.compose(
      interceptors.dns({ lookup: strictDnsLookup }),
    );
    try {
      const response = await dispatcher.request({
        origin: "https://api.example.com",
        path: "/",
        method: "GET",
      });
      expect(await response.body.text()).toBe("fixture");
    } finally {
      await mock.close();
    }
  });
  it("rejects unsafe targets at the factory boundary", async () => {
    const policy = strictNetworkAgentFactory("https://example.com", {});
    try {
      await expect(
        policy.request({
          origin: "http://localhost",
          path: "/",
          method: "GET",
        }),
      ).rejects.toThrow(NetworkPolicyError);
    } finally {
      await policy.close();
    }
  });
  it("pins the connection IP while retaining the original TLS server name", async () => {
    const connect = vi.fn<buildConnector.connector>((_options, callback) => {
      callback(Error("fixture stopped before network access"), null);
    });
    vi.mocked(lookup).mockResolvedValueOnce([
      { address: "8.8.8.8", family: 4 },
    ] as never);
    const policy = strictNetworkAgentFactory("https://api.example.com", {
      connect,
    });
    try {
      await expect(
        policy.request({
          origin: "https://api.example.com",
          path: "/",
          method: "GET",
        }),
      ).rejects.toThrow("fixture stopped");
      expect(connect).toHaveBeenCalledWith(
        expect.objectContaining({
          hostname: "8.8.8.8",
          servername: "api.example.com",
          protocol: "https:",
        }),
        expect.any(Function),
      );
    } finally {
      await policy.destroy();
    }
  });
  it("selects NO_PROXY before pinning and preserves the proxy CONNECT route", async () => {
    const proxy = createServer();
    const sockets = new Set<Socket>();
    const tunnels: string[] = [];
    proxy.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    proxy.on("connect", (request, socket) => {
      tunnels.push(request.url ?? "");
      socket.end(
        "HTTP/1.1 502 Fixture Stop\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
      );
    });
    proxy.listen(0, "127.0.0.1");
    await once(proxy, "listening");
    const port = (proxy.address() as { port: number }).port;
    try {
      for (const noProxy of ["", "api.example.com"]) {
        const direct = vi.fn<buildConnector.connector>((_options, callback) => {
          callback(Error("fixture direct connection"), null);
        });
        const policy = new EnvHttpProxyAgent({
          httpProxy: `http://127.0.0.1:${port}`,
          httpsProxy: `http://127.0.0.1:${port}`,
          noProxy,
          factory: strictNetworkAgentFactory,
          connect: direct,
        });
        vi.mocked(lookup).mockResolvedValueOnce([
          { address: "8.8.8.8", family: 4 },
        ] as never);
        try {
          await expect(
            policy.request({
              origin: "https://api.example.com",
              path: "/",
              method: "GET",
              signal: AbortSignal.timeout(3000),
            }),
          ).rejects.toThrow(noProxy ? "fixture direct connection" : "502");
          expect(direct).toHaveBeenCalledTimes(noProxy ? 1 : 0);
          expect(tunnels).toEqual(["8.8.8.8:443"]);
        } finally {
          await policy.destroy();
        }
      }
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
  });
  it("enforces strict mode through the real global fetch dispatcher", async () => {
    const original = getGlobalDispatcher();
    for (const mode of ["direct", "custom"] as const) {
      configureProxy({
        PI_DESKTOP_PROXY_MODE: mode,
        PI_DESKTOP_PROXY_URL: "http://127.0.0.1:9",
        PI_DESKTOP_NETWORK_POLICY: "strict",
      });
      const dispatcher = getGlobalDispatcher();
      try {
        for (const url of [
          "http://example.com",
          "https://127.0.0.1",
          "https://198.18.0.1",
        ]) {
          await expect(fetch(url)).rejects.toMatchObject({
            cause: { code: "NETWORK_POLICY_BLOCKED" },
          });
        }
      } finally {
        setGlobalDispatcher(original);
        await dispatcher.destroy();
      }
    }
  });
});
