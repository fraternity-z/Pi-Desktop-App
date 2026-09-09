import { isAbsolute } from "node:path";

import { PROTOCOL_VERSION } from "./protocol.js";

export interface BridgeOptions {
  sdkRoot: string;
  agentDir: string;
}

export class CliError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CliError";
  }
}

/** Reject unsupported Node before paying the cost of importing the Pi SDK. */
export function assertSupportedNode(version: string): void {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][\w.-]+)?$/.exec(version);
  if (!match || Number(match[1]) < 22 || (Number(match[1]) === 22 && Number(match[2]) < 19)) {
    throw new CliError("NODE_VERSION_UNSUPPORTED", "Node.js 版本不受支持，需要 22.19 或更高版本");
  }
}

export function parseBridgeOptions(argv: readonly string[]): BridgeOptions {
  const values = new Map<string, string | true>();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--stdio") {
      if (values.has(argument)) {
        throw new CliError("DUPLICATE_ARGUMENT", `参数 ${argument} 不能重复`);
      }
      values.set(argument, true);
      continue;
    }

    if (!["--sdk-root", "--agent-dir", "--protocol"].includes(argument)) {
      throw new CliError("UNKNOWN_ARGUMENT", `未知参数 ${argument}`);
    }
    if (values.has(argument)) {
      throw new CliError("DUPLICATE_ARGUMENT", `参数 ${argument} 不能重复`);
    }

    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new CliError("MISSING_ARGUMENT_VALUE", `参数 ${argument} 缺少值`);
    }
    values.set(argument, value);
    index += 1;
  }

  for (const required of ["--sdk-root", "--agent-dir", "--protocol", "--stdio"]) {
    if (!values.has(required)) {
      throw new CliError("MISSING_ARGUMENT", `缺少必需参数 ${required}`);
    }
  }

  const protocol = values.get("--protocol");
  if (protocol !== `v${PROTOCOL_VERSION}`) {
    throw new CliError("UNSUPPORTED_PROTOCOL", `启动协议必须为 v${PROTOCOL_VERSION}`);
  }

  const sdkRoot = values.get("--sdk-root");
  const agentDir = values.get("--agent-dir");
  if (typeof sdkRoot !== "string" || !isAbsolute(sdkRoot)) {
    throw new CliError("INVALID_SDK_ROOT", "--sdk-root 必须为绝对路径");
  }
  if (typeof agentDir !== "string" || !isAbsolute(agentDir)) {
    throw new CliError("INVALID_AGENT_DIR", "--agent-dir 必须为绝对路径");
  }

  return { sdkRoot, agentDir };
}
