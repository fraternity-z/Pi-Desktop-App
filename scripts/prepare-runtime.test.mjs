import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { mock, test } from "node:test";

import { archiveChecksum, nodeDistribution, prepareRuntime } from "./prepare-runtime.mjs";

const packageName = "@earendil-works/pi-coding-agent";
const sdkRelative = join("node_modules", "@earendil-works", "pi-coding-agent");

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "pi-runtime-prepare-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "runtime"));
  await writeFile(join(root, "runtime", "versions.json"), JSON.stringify({ node: "22.22.0", pi: "0.84.2" }));
  await writeFile(join(root, "runtime", "package.json"), JSON.stringify({ dependencies: { [packageName]: "0.84.2" } }));
  await writeFile(join(root, "runtime", "package-lock.json"), JSON.stringify({ lockfileVersion: 3 }));
  const bytes = Buffer.from("fixture archive");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const distribution = nodeDistribution("22.22.0", "win32", "x64");
  const dependencies = {
    fetch: mock.fn(async (url) => new Response(url.endsWith("SHASUMS256.txt") ? `${hash}  ${distribution.archive}\n` : bytes)),
    exec: mock.fn(async (_program, args, options) => {
      if (args[0] === "-xf") {
        const directory = join(args[3], distribution.directory);
        await mkdir(join(directory, "node_modules", "npm", "bin"), { recursive: true });
        await writeFile(join(directory, "node.exe"), "node fixture");
        await writeFile(join(directory, "LICENSE"), "Node license fixture");
        await writeFile(join(directory, "node_modules", "npm", "bin", "npm-cli.js"), "fixture");
        for (const launcher of ["npm", "npm.cmd", "npm.ps1", "npx", "npx.cmd", "npx.ps1"]) {
          await writeFile(join(directory, launcher), "fixture");
        }
      } else if (args[1] === "ci") {
        const sdk = join(options.cwd, sdkRelative);
        await mkdir(join(sdk, "dist"), { recursive: true });
        await writeFile(join(sdk, "package.json"), JSON.stringify({ name: packageName, version: "0.84.2" }));
        await writeFile(join(sdk, "dist", "index.js"), "export {};\n");
      }
      return { stdout: "", stderr: "" };
    }),
  };
  return { options: { root, platform: "win32", arch: "x64" }, dependencies, root };
}

test("构建准备使用固定 Node、生产依赖和官方归档校验；缓存命中完全离线", async (t) => {
  const { options, dependencies } = await fixture(t);
  const first = await prepareRuntime(options, dependencies);
  assert.equal(first.prepared, true);
  assert.equal(dependencies.exec.mock.callCount(), 3);
  const install = dependencies.exec.mock.calls[1];
  assert.deepEqual(install.arguments[1].slice(1), ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"]);
  assert.equal(install.arguments[2].shell, undefined);
  const second = await prepareRuntime(options, dependencies);
  assert.equal(second.prepared, false);
  assert.equal(dependencies.fetch.mock.callCount(), 2);
  assert.equal(dependencies.exec.mock.callCount(), 3);
});

test("入口缺失时重建，并复用已校验的下载归档", async (t) => {
  const { options, dependencies } = await fixture(t);
  const first = await prepareRuntime(options, dependencies);
  await rm(join(first.destination, sdkRelative, "dist", "index.js"));
  assert.equal((await prepareRuntime(options, dependencies)).prepared, true);
  assert.equal(dependencies.fetch.mock.callCount(), 3);
});

test("拒绝篡改归档，不执行解压或安装", async (t) => {
  const { options, dependencies } = await fixture(t);
  const fetch = dependencies.fetch;
  dependencies.fetch = async (url, init) => url.endsWith("SHASUMS256.txt") ? fetch(url, init) : new Response("tampered");
  await assert.rejects(prepareRuntime(options, dependencies), /SHA-256/);
  assert.equal(dependencies.exec.mock.callCount(), 0);
});

test("安装失败不替换已有资源、不泄露子进程输出，释放锁后可重试", async (t) => {
  const { options, dependencies } = await fixture(t);
  const first = await prepareRuntime(options, dependencies);
  const stamp = await readFile(join(first.destination, ".prepared.json"), "utf8");
  const exec = dependencies.exec;
  dependencies.exec = async (program, args, opts) => {
    if (args[1] === "ci") throw new Error("fixture-sensitive-output");
    return exec(program, args, opts);
  };
  await assert.rejects(prepareRuntime({ ...options, force: true }, dependencies), (error) => {
    assert.match(error.message, /生产依赖安装失败/);
    assert.ok(!error.message.includes("fixture-sensitive-output"));
    return true;
  });
  assert.equal(await readFile(join(first.destination, ".prepared.json"), "utf8"), stamp);
  assert.equal((await prepareRuntime(options, dependencies)).prepared, false);
});

test("并发构建不会同时写入同一套内置资源", async (t) => {
  const { options, dependencies } = await fixture(t);
  let unblock;
  let entered;
  const blocked = new Promise((resolve) => { unblock = resolve; });
  const reachedDownload = new Promise((resolve) => { entered = resolve; });
  const fetch = dependencies.fetch;
  dependencies.fetch = async (...args) => { entered(); await blocked; return fetch(...args); };
  const first = prepareRuntime(options, dependencies);
  await reachedDownload;
  try {
    await assert.rejects(prepareRuntime(options, dependencies), /正在准备/);
  } finally { unblock(); }
  await first;
});

test("平台、版本和校验清单边界", () => {
  assert.match(nodeDistribution("22.22.0", "darwin", "arm64").archive, /darwin-arm64.tar.gz$/);
  assert.match(nodeDistribution("22.22.0", "linux", "x64").archive, /linux-x64.tar.gz$/);
  assert.throws(() => nodeDistribution("../22", "win32", "x64"));
  assert.throws(() => nodeDistribution("22.22.0", "win32", "ia32"));
  assert.throws(() => nodeDistribution("22.22.0", "android", "arm64"));
  assert.throws(() => archiveChecksum("bad  file.zip", "file.zip"));
  assert.throws(() => archiveChecksum("", "file.zip"));
});

test("版本配置不一致时不准备资源", async (t) => {
  const { options, dependencies, root } = await fixture(t);
  await writeFile(join(root, "runtime", "versions.json"), JSON.stringify({ node: "22.22.0", pi: "0.85.0" }));
  await assert.rejects(prepareRuntime(options, dependencies), /不一致/);
  assert.equal(dependencies.fetch.mock.callCount(), 0);
});

test("下载错误释放构建锁", async (t) => {
  const { options, dependencies, root } = await fixture(t);
  dependencies.fetch = async () => new Response("", { status: 503 });
  await assert.rejects(prepareRuntime(options, dependencies), /HTTP 503/);
  await assert.rejects(access(join(root, "output", "runtime-downloads", "prepare.lock")));
  await access(dirname(join(root, "runtime", "package.json")));
});
