import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { Agent, interceptors, type Dispatcher } from "undici";

export class NetworkPolicyError extends Error {
  readonly code = "NETWORK_POLICY_BLOCKED";
  constructor() {
    super(
      "严格网络模式仅允许公网 HTTPS。可信的本机、局域网或 fake-IP 服务可在常规设置中开启网络宽松模式。",
    );
  }
}

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  blocked.addSubnet(address, prefix, "ipv6");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  if (family === 6)
    return globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
  return false;
}

export function validateStrictOrigin(value: string | URL): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new NetworkPolicyError();
  }
  let host = url.hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    (isIP(host) !== 0 && !isPublicAddress(host))
  )
    throw new NetworkPolicyError();
}

export const strictDnsLookup: NonNullable<
  interceptors.DNSInterceptorOpts["lookup"]
> = (origin, _options, callback) => {
  const host = origin.hostname.startsWith("[")
    ? origin.hostname.slice(1, -1)
    : origin.hostname;
  const family = isIP(host);
  if (family === 4 || family === 6) {
    if (!isPublicAddress(host)) callback(new NetworkPolicyError(), []);
    else callback(null, [{ address: host, family, ttl: 60_000 }]);
    return;
  }
  void lookup(origin.hostname, { all: true }).then(
    (addresses) => {
      if (
        !addresses.length ||
        addresses.some(({ address }) => !isPublicAddress(address))
      ) {
        callback(new NetworkPolicyError(), []);
        return;
      }
      callback(
        null,
        addresses.map(({ address, family }) => ({
          address,
          family: family as 4 | 6,
          ttl: 60_000,
        })),
      );
    },
    () => callback(new NetworkPolicyError(), []),
  );
};

// Called AFTER EnvHttpProxyAgent selects a route using the original hostname.
// Retain the selected connector: DNS pinning must not change NO_PROXY or CONNECT.
export function strictNetworkAgentFactory(
  _origin: string | URL,
  options: object,
): Dispatcher {
  const { factory: _factory, ...connectionOptions } = options as Agent.Options;
  return new Agent(connectionOptions).compose(
    interceptors.dns({
      lookup: strictDnsLookup,
      maxTTL: 60_000,
      maxItems: 256,
    }),
    (dispatch) => (options, handler) => {
      validateStrictOrigin(String(options.origin));
      return dispatch(options, handler);
    },
  );
}
