import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { open, realpath } from "node:fs/promises";
import { readPackageVersion } from "./package-version.js";

vi.mock("node:fs/promises", () => ({ open: vi.fn(), realpath: vi.fn() }));

const root = resolve("fixtures/plugin");
const close = vi.fn(async () => undefined);
let content = "";
const file = {
  stat: vi.fn(async () => ({ isFile: (): boolean => true, size: Buffer.byteLength(content) })),
  read: vi.fn(async (buffer: Buffer) => ({ bytesRead: buffer.write(content) })),
  close,
};

describe("readPackageVersion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    content = '{"version":"1.2.3-beta.1+build.2"}';
    vi.mocked(realpath).mockImplementation(async (path) => String(path));
    vi.mocked(open).mockResolvedValue(file as unknown as Awaited<ReturnType<typeof open>>);
  });

  it("从安装包清单提取版本且关闭文件", async () => {
    expect(await readPackageVersion(root)).toBe("1.2.3-beta.1+build.2");
    expect(open).toHaveBeenCalledWith(join(root, "package.json"), "r");
    expect(close).toHaveBeenCalledOnce();
  });

  it.each([undefined, "relative/path"])("忽略无效安装路径 %s", async (path) => {
    expect(await readPackageVersion(path)).toBeUndefined();
    expect(open).not.toHaveBeenCalled();
  });

  it.each(['{}', 'null', '{"version":123}', '{"version":"invalid"}', '{"version":"1.0.0\\nsecret"}', 'broken'])
  ("元数据损坏时降级：%s", async (manifest) => {
    content = manifest;
    expect(await readPackageVersion(root)).toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
  });

  it("支持 UTF-8 BOM", async () => {
    content = '\uFEFF{"version":"2.0.0"}';
    expect(await readPackageVersion(root)).toBe("2.0.0");
  });

  it("拒绝超大清单和目录", async () => {
    content = " ".repeat(65_537);
    expect(await readPackageVersion(root)).toBeUndefined();
    expect(file.read).not.toHaveBeenCalled();
    file.stat.mockResolvedValueOnce({ isFile: () => false, size: 1 });
    expect(await readPackageVersion(root)).toBeUndefined();
  });

  it("检查期间增长的清单仍受读取上限约束", async () => {
    content = " ".repeat(65_537);
    file.stat.mockResolvedValueOnce({ isFile: () => true, size: 10 });
    expect(await readPackageVersion(root)).toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
  });

  it("拒绝清单链接到包目录之外", async () => {
    vi.mocked(realpath).mockResolvedValueOnce(root).mockResolvedValueOnce(resolve("outside/package.json"));
    expect(await readPackageVersion(root)).toBeUndefined();
    expect(open).not.toHaveBeenCalled();
  });

  it("文件缺失或读取失败不影响插件列表", async () => {
    vi.mocked(open).mockRejectedValueOnce(new Error("missing"));
    expect(await readPackageVersion(root)).toBeUndefined();
    file.read.mockRejectedValueOnce(new Error("denied"));
    expect(await readPackageVersion(root)).toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
  });
});
