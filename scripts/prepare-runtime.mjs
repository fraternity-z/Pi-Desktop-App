import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, copyFile, cp, mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const PI_PACKAGE = "@earendil-works/pi-coding-agent";
const exec = promisify(execFile);
const defaults = { fetch: globalThis.fetch, exec };
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function nodeDistribution(version, platform, arch) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !["x64", "arm64"].includes(arch)) {
    throw new Error("内置 Node 版本或架构不受支持");
  }
  const os = { win32: "win", darwin: "darwin", linux: "linux" }[platform];
  if (!os) throw new Error(`当前平台不支持准备内置 Node：${platform}`);
  const directory = `node-v${version}-${os}-${arch}`;
  return { directory, archive: `${directory}.${platform === "win32" ? "zip" : "tar.gz"}` };
}

export function archiveChecksum(text, filename) {
  const entry = text.split(/\r?\n/).map((line) => line.trim().split(/\s+/))
    .find((parts) => parts[1]?.replace(/^\*/, "") === filename);
  if (!entry || !/^[a-f0-9]{64}$/i.test(entry[0])) throw new Error("官方 Node 校验清单缺少目标归档");
  return entry[0].toLowerCase();
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function download(url, dependencies) {
  const response = await dependencies.fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`下载内置 Node 失败：HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function prepareRuntime(options = {}, dependencies = defaults) {
  const root = resolve(options.root ?? projectRoot);
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const configRoot = join(root, "runtime");
  const versions = JSON.parse(await readFile(join(configRoot, "versions.json"), "utf8"));
  const manifest = await readFile(join(configRoot, "package.json"), "utf8");
  const lockfile = await readFile(join(configRoot, "package-lock.json"), "utf8");
  if (JSON.parse(manifest).dependencies?.[PI_PACKAGE] !== versions.pi) {
    throw new Error("内置 Pi 版本与生产依赖清单不一致");
  }
  const distribution = nodeDistribution(versions.node, platform, arch);
  const fingerprint = sha256(JSON.stringify({ packagingVersion: 3, versions, platform, arch, manifest, lockfile }));
  const destination = join(root, "src-tauri", "resources", "pi-bridge", "pi-runtime");
  const nodeName = platform === "win32" ? "node.exe" : "node";
  const sdkRelative = join("node_modules", "@earendil-works", "pi-coding-agent");
  const cache = join(root, "output", "runtime-downloads");
  await mkdir(cache, { recursive: true });
  const lockPath = join(cache, "prepare.lock");
  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("内置运行时正在准备；若上次进程意外退出，请清理 output/runtime-downloads/prepare.lock 后重试");
    throw error;
  }
  let staging;
  let backup;
  let preserveBackup = false;
  try {
    await lock.writeFile(String(process.pid));
    if (!options.force) {
      try {
        const stamp = JSON.parse(await readFile(join(destination, ".prepared.json"), "utf8"));
        const sdk = JSON.parse(await readFile(join(destination, sdkRelative, "package.json"), "utf8"));
        if (stamp.fingerprint === fingerprint && sdk.name === PI_PACKAGE && sdk.version === versions.pi
          && await exists(join(destination, nodeName))
          && await exists(join(destination, "node_modules", "npm", "bin", "npm-cli.js"))
          && await exists(join(destination, platform === "win32" ? "npm.cmd" : "npm"))
          && await exists(join(destination, sdkRelative, "dist", "index.js"))) {
          return { destination, prepared: false, node: versions.node, pi: versions.pi };
        }
      } catch { /* Missing or invalid cache is rebuilt in an isolated staging directory. */ }
    }

    const baseUrl = `https://nodejs.org/dist/v${versions.node}/`;
    const checksums = await download(`${baseUrl}SHASUMS256.txt`, dependencies);
    const expected = archiveChecksum(checksums.toString("utf8"), distribution.archive);
    const archivePath = join(cache, distribution.archive);
    let archive = await readFile(archivePath).catch(() => undefined);
    if (!archive || sha256(archive) !== expected) {
      archive = await download(`${baseUrl}${distribution.archive}`, dependencies);
      if (sha256(archive) !== expected) throw new Error("内置 Node 归档 SHA-256 校验失败");
      await writeFile(archivePath, archive);
    }
    const extracted = await mkdtemp(join(cache, "node-"));
    try {
      const tar = platform === "win32"
        ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
      await dependencies.exec(tar, ["-xf", archivePath, "-C", extracted], { windowsHide: true, timeout: 120_000 });
      const nodeRoot = join(extracted, distribution.directory);
      const nodePath = platform === "win32" ? join(nodeRoot, "node.exe") : join(nodeRoot, "bin", "node");
      const npmCli = platform === "win32" ? join(nodeRoot, "node_modules", "npm", "bin", "npm-cli.js")
        : join(nodeRoot, "lib", "node_modules", "npm", "bin", "npm-cli.js");
      staging = await mkdtemp(join(cache, "runtime-"));
      await writeFile(join(staging, "package.json"), manifest);
      await writeFile(join(staging, "package-lock.json"), lockfile);
      try {
        await dependencies.exec(nodePath, [npmCli, "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
          cwd: staging, windowsHide: true, timeout: 600_000, maxBuffer: 4 * 1024 * 1024,
        });
      } catch {
        throw new Error("内置 Pi 生产依赖安装失败，请检查网络和 npm 配置后重试");
      }
      await copyFile(nodePath, join(staging, nodeName));
      await copyFile(join(nodeRoot, "LICENSE"), join(staging, "NODE-LICENSE"));
      await cp(dirname(dirname(npmCli)), join(staging, "node_modules", "npm"), { recursive: true });
      if (platform === "win32") {
        for (const launcher of ["npm", "npm.cmd", "npm.ps1", "npx", "npx.cmd", "npx.ps1"]) {
          await copyFile(join(nodeRoot, launcher), join(staging, launcher));
        }
      } else {
        for (const launcher of ["npm", "npx"]) {
          await writeFile(join(staging, launcher), `#!/usr/bin/env node\nprocess.argv[1] = require.resolve('./node_modules/npm/bin/${launcher}-cli.js');\nrequire(process.argv[1]);\n`, { mode: 0o755 });
        }
      }
      const smoke = "const sdk = await import(process.argv[1]); if (typeof sdk.createAgentSession !== 'function' || typeof sdk.ModelRuntime?.create !== 'function' || typeof sdk.SessionManager?.listAll !== 'function' || typeof sdk.SettingsManager?.create !== 'function' || typeof sdk.DefaultResourceLoader !== 'function' || typeof sdk.DefaultPackageManager !== 'function') throw new Error('SDK exports missing');";
      await dependencies.exec(join(staging, nodeName), ["--input-type=module", "-e", smoke,
        pathToFileURL(join(staging, sdkRelative, "dist", "index.js")).href], {
        cwd: staging, windowsHide: true, timeout: 60_000,
        env: { ...process.env, PI_CODING_AGENT_DIR: join(cache, "smoke-agent"), NODE_DISABLE_COMPILE_CACHE: "1" },
      });
      await writeFile(join(staging, ".prepared.json"), `${JSON.stringify({ schemaVersion: 1, fingerprint, node: versions.node, pi: versions.pi, platform, arch }, null, 2)}\n`);
      await mkdir(dirname(destination), { recursive: true });
      if (await exists(destination)) {
        backup = await mkdtemp(join(cache, "previous-"));
        await rename(destination, join(backup, "runtime"));
      }
      try {
        await rename(staging, destination);
        staging = undefined;
      } catch (error) {
        if (backup) {
          preserveBackup = true;
          await rename(join(backup, "runtime"), destination);
          preserveBackup = false;
        }
        throw error;
      }
      return { destination, prepared: true, node: versions.node, pi: versions.pi };
    } finally {
      await rm(extracted, { recursive: true, force: true });
    }
  } finally {
    try {
      if (staging) await rm(staging, { recursive: true, force: true });
      if (backup && !preserveBackup) await rm(backup, { recursive: true, force: true });
    } finally {
      await lock.close();
      await rm(lockPath, { force: true });
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareRuntime({ force: process.argv.includes("--force") }).then((result) => {
    console.log(`内置运行时${result.prepared ? "已准备" : "缓存有效"}：Node ${result.node} / Pi ${result.pi}`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "内置运行时准备失败");
    process.exitCode = 1;
  });
}
