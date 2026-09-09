import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

export interface CompileCacheDependencies {
  env: NodeJS.ProcessEnv;
  enable?: (directory?: string) => unknown;
  temporaryDirectory: () => string;
}

const defaults: CompileCacheDependencies = {
  env: process.env,
  enable: nodeModule.enableCompileCache,
  temporaryDirectory: tmpdir,
};

/** Node validates source/version keys; cache availability never gates SDK startup. */
export function enableSdkCompileCache(dependencies: CompileCacheDependencies = defaults): void {
  if (!dependencies.enable || dependencies.env.NODE_DISABLE_COMPILE_CACHE === "1") return;
  const configured = dependencies.env.PI_DESKTOP_COMPILE_CACHE_DIR ?? dependencies.env.NODE_COMPILE_CACHE;
  if (configured && !isAbsolute(configured)) return;
  try {
    dependencies.enable(configured || join(dependencies.temporaryDirectory(), "pi-desktop-compile-cache"));
  } catch {
    // Unsupported Node versions, read-only caches and test doubles retain uncached behavior.
  }
}
