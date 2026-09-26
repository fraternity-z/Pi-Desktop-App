import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "jsonc-parser";
import {
  boundedText,
  readModelConfig,
  safeWebUrl,
  saveProviderModel,
  validateProviderId,
  validateProviderModel,
  type ProviderModelInput,
} from "./provider-config.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pi-provider-test-"));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
async function input(
  patch: Partial<ProviderModelInput> = {},
): Promise<ProviderModelInput> {
  return {
    provider: "example",
    baseUrl: "https://example.test/v1",
    api: "openai-completions",
    modelId: "example-model",
    modelName: "Example",
    reasoning: false,
    contextWindow: 32000,
    maxTokens: 4096,
    expectedRevision: (await readModelConfig(dir)).revision,
    ...patch,
  };
}

describe("provider config validation", () => {
  it.each([
    "../outside",
    "constructor",
    "__proto__",
    "prototype",
    "UPPER",
    "",
    "a".repeat(129),
  ])("rejects unsafe provider %s", (value) => {
    expect(() => validateProviderId(value)).toThrow();
  });
  it("accepts bounded identifiers and normalizes text", () => {
    expect(validateProviderId("local-provider.v2")).toBe("local-provider.v2");
    expect(boundedText(" hello ", 20, "name")).toBe("hello");
    expect(() => boundedText("a\0b", 20, "name")).toThrow();
  });
  it.each([
    "file:///tmp/a",
    "javascript:alert(1)",
    "http://remote.test",
    "https://user:pass@example.test",
    "bad url",
  ])("rejects unsafe URL %s", (value) => {
    expect(safeWebUrl(value)).toBeUndefined();
  });
  it("allows local HTTP but rejects endpoint query secrets", () => {
    expect(safeWebUrl("http://localhost:11434/v1", false)).toContain(
      "localhost",
    );
    expect(safeWebUrl("https://example.test/v1?key=x", false)).toBeUndefined();
    expect(safeWebUrl("https://example.test/oauth?state=x")).toContain(
      "state=x",
    );
    expect(safeWebUrl(undefined)).toBeUndefined();
  });
  it.each([
    { api: "shell" },
    { apiKeyEnv: "!cat secrets" },
    { apiKeyEnv: "sk-test-fake" },
    { maxTokens: 0 },
    { maxTokens: 64000 },
    { contextWindow: 1.5 },
    { reasoning: "true" },
    { expectedRevision: "old" },
    { baseUrl: "file:///x" },
    { modelId: "" },
  ])("validates every editable model field %j", async (patch) => {
    const valid = await input();
    expect(() => validateProviderModel({ ...valid, ...patch })).toThrow();
  });
});

describe("Pi models.json editing", () => {
  it("creates native configuration with environment references only", async () => {
    vi.stubEnv("PI_TEST_PROVIDER_KEY", "fixture-not-a-real-key");
    await saveProviderModel(
      dir,
      await input({ apiKeyEnv: "PI_TEST_PROVIDER_KEY" }),
    );
    const text = await readFile(join(dir, "models.json"), "utf8");
    const data = parse(text);
    expect(data.providers.example.apiKey).toBe("${PI_TEST_PROVIDER_KEY}");
    expect(data.providers.example.models[0].id).toBe("example-model");
    expect(text).not.toContain("fixture-not-a-real-key");
  });
  it("preserves comments, other providers, auth and unknown model fields", async () => {
    await writeFile(
      join(dir, "models.json"),
      '// user comment\n{"extra":true,"providers":{"other":{"baseUrl":"https://other.test"},"example":{"apiKey":"EXISTING_REF","headers":{"x-custom":"keep"},"models":[{"id":"example-model","compat":{"supportsStore":false}},{"id":"untouched"}]}}}',
    );
    await saveProviderModel(dir, await input({ modelName: "Updated" }));
    const text = await readFile(join(dir, "models.json"), "utf8");
    const data = parse(text);
    expect(text).toContain("// user comment");
    expect(data.extra).toBe(true);
    expect(data.providers.other).toEqual({ baseUrl: "https://other.test" });
    expect(data.providers.example.apiKey).toBe("EXISTING_REF");
    expect(data.providers.example.headers).toEqual({ "x-custom": "keep" });
    expect(data.providers.example.models[0]).toMatchObject({
      name: "Updated",
      compat: { supportsStore: false },
    });
    expect(data.providers.example.models[1]).toEqual({ id: "untouched" });
  });
  it("rejects an unset environment reference with an actionable message", async () => {
    vi.stubEnv("PI_TEST_MISSING_KEY", "");
    await expect(
      saveProviderModel(dir, await input({ apiKeyEnv: "PI_TEST_MISSING_KEY" })),
    ).rejects.toMatchObject({ code: "API_KEY_ENV_MISSING" });
  });
  it("detects concurrent changes and preserves the external edit", async () => {
    const stale = await input();
    await writeFile(join(dir, "models.json"), '{"external":true}');
    await expect(saveProviderModel(dir, stale)).rejects.toMatchObject({
      code: "MODEL_CONFIG_CONFLICT",
    });
    expect(await readFile(join(dir, "models.json"), "utf8")).toBe(
      '{"external":true}',
    );
  });
  it.each(["{broken", "[]", '{"providers":[]}', '{"providers":{},}'])(
    "refuses malformed native config without replacing it",
    async (text) => {
      await writeFile(join(dir, "models.json"), text);
      await expect(readModelConfig(dir)).rejects.toMatchObject({
        code: "MODEL_CONFIG_INVALID",
      });
      expect(await readFile(join(dir, "models.json"), "utf8")).toBe(text);
    },
  );
  it.each([
    '{"providers":{"example":false}}',
    '{"providers":{"example":{"models":{}}}}',
  ])("refuses invalid existing provider structure", async (text) => {
    await writeFile(join(dir, "models.json"), text);
    await expect(saveProviderModel(dir, await input())).rejects.toMatchObject({
      code: "MODEL_CONFIG_INVALID",
    });
  });
  it("bounds native file size", async () => {
    await writeFile(join(dir, "models.json"), " ".repeat(1024 * 1024 + 1));
    await expect(readModelConfig(dir)).rejects.toMatchObject({
      code: "MODEL_CONFIG_TOO_LARGE",
    });
  });
});
