import { open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";

const MAX_MANIFEST_BYTES = 64 * 1024;

/** Read only the version from an SDK-resolved installation, with bounded I/O. */
export async function readPackageVersion(installedPath?: string): Promise<string | undefined> {
  if (!installedPath || !isAbsolute(installedPath)) return undefined;
  try {
    const root = await realpath(installedPath);
    const manifestPath = await realpath(join(root, "package.json"));
    if (relative(root, manifestPath) !== "package.json") return undefined;
    const file = await open(manifestPath, "r");
    try {
      const metadata = await file.stat();
      if (!metadata.isFile() || metadata.size > MAX_MANIFEST_BYTES) return undefined;
      const buffer = Buffer.alloc(MAX_MANIFEST_BYTES + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_MANIFEST_BYTES) return undefined;
      const manifest: unknown = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8").replace(/^\uFEFF/, ""));
      if (!manifest || typeof manifest !== "object" || !("version" in manifest)) return undefined;
      const version = manifest.version;
      return typeof version === "string" && version.length <= 128 &&
        /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)
        ? version : undefined;
    } finally {
      await file.close();
    }
  } catch {
    // Missing or unreadable metadata must not hide an otherwise usable plugin.
    return undefined;
  }
}
