import { describe, expect, it } from "vitest";

import { CliError, parseBridgeOptions } from "./cli.js";

const validArguments = [
  "--sdk-root",
  "C:\\pi\\sdk",
  "--agent-dir",
  "C:\\users\\me\\.pi",
  "--protocol",
  "v1",
  "--stdio",
] as const;

describe("parseBridgeOptions", () => {
  it("解析固定启动参数", () => {
    expect(parseBridgeOptions(validArguments)).toEqual({
      sdkRoot: "C:\\pi\\sdk",
      agentDir: "C:\\users\\me\\.pi",
    });
  });

  it.each([
    ["MISSING_ARGUMENT", validArguments.slice(0, -1)],
    ["UNKNOWN_ARGUMENT", [...validArguments, "--verbose"]],
    ["DUPLICATE_ARGUMENT", [...validArguments, "--stdio"]],
    ["MISSING_ARGUMENT_VALUE", ["--sdk-root", "--stdio"]],
    ["UNSUPPORTED_PROTOCOL", validArguments.map((value) => (value === "v1" ? "v2" : value))],
    ["INVALID_SDK_ROOT", validArguments.map((value) => (value === "C:\\pi\\sdk" ? "pi/sdk" : value))],
    [
      "INVALID_AGENT_DIR",
      validArguments.map((value) => (value === "C:\\users\\me\\.pi" ? ".pi" : value)),
    ],
  ])("拒绝无效参数并返回 %s", (code, arguments_) => {
    expect(() => parseBridgeOptions(arguments_)).toThrowError(
      expect.objectContaining<Partial<CliError>>({ code }),
    );
  });
});
