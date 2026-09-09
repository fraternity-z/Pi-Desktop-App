import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface RuntimeToolDependencies {
  executable: string;
  version: string;
  platform: string;
  arch: string;
  env: NodeJS.ProcessEnv;
  readManifest(path: string): string;
}

const defaults: RuntimeToolDependencies = {
  executable: process.execPath,
  version: process.versions.node,
  platform: process.platform,
  arch: process.arch,
  env: process.env,
  readManifest: (path) => readFileSync(path, "utf8"),
};

/** Only a build-stamped bundled Node changes its own child-process tool PATH. */
export function configureRuntimeTools(dependencies: RuntimeToolDependencies = defaults): void {
  const directory = dirname(dependencies.executable);
  try {
    const stamp = JSON.parse(dependencies.readManifest(join(directory, ".prepared.json")));
    if (!stamp || stamp.schemaVersion !== 1 || stamp.node !== dependencies.version
      || stamp.platform !== dependencies.platform || stamp.arch !== dependencies.arch) return;
    const separator = dependencies.platform === "win32" ? ";" : ":";
    const key = (path: string) => dependencies.platform === "win32" ? path.toLowerCase() : path;
    const paths = (dependencies.env.PATH ?? dependencies.env.Path ?? "").split(separator)
      .filter((path) => path && key(path) !== key(directory));
    const path = [directory, ...paths].join(separator);
    dependencies.env.PATH = path;
    if (dependencies.platform === "win32") dependencies.env.Path = path;
  } catch {
    // Local Node, a missing stamp, or a read-only environment retains its original PATH.
  }
}
