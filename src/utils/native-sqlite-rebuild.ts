import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const localRequire = createRequire(import.meta.url);

/** Find an installed script without executing a PATH-selected Node or npx. */
export function findNodeGyp(searchPath = process.env["PATH"] ?? ""): string {
  try {
    return localRequire.resolve("node-gyp/bin/node-gyp.js");
  } catch { /* A global installation or npm may provide the build tool. */ }
  const candidates = [process.env["npm_config_node_gyp"]];
  for (const directory of searchPath.split(path.delimiter).filter(Boolean)) {
    for (const name of ["node-gyp", "node-gyp.js", "npm", "npm-cli.js"]) {
      try {
        const script = fs.realpathSync(path.join(directory, name));
        if (path.basename(script) === "node-gyp.js") candidates.push(script);
        if (path.basename(script) === "npm-cli.js") {
          candidates.push(path.resolve(path.dirname(script), "../node_modules/node-gyp/bin/node-gyp.js"));
        }
      } catch { /* This PATH entry does not provide that tool. */ }
    }
    candidates.push(path.join(directory, "node_modules/npm/node_modules/node-gyp/bin/node-gyp.js"));
  }
  const found = candidates.find(candidate => candidate?.endsWith(".js") && fs.existsSync(candidate));
  if (!found) throw new Error("No installed node-gyp JavaScript entry point found; install node-gyp and retry.");
  return fs.realpathSync(found);
}

interface RebuildOptions {
  packageDir?: string;
  nodeGyp?: string;
  runtime?: { execPath: string; version: string; arch: string };
  run?: (executable: string, args: string[], options: ExecFileSyncOptions) => unknown;
}

/** Compile and verify away from the installed binding; publish only verified bytes. */
export function rebuildNativeSqlite(options: RebuildOptions = {}): boolean {
  let staging: string | undefined;
  let installStaging: string | undefined;
  try {
    const packageDir = options.packageDir ?? path.dirname(localRequire.resolve("better-sqlite3/package.json"));
    const nodeGyp = options.nodeGyp ?? findNodeGyp();
    const runtime = options.runtime ?? { execPath: process.execPath, version: process.versions.node, arch: process.arch };
    const run = options.run ?? execFileSync;
    staging = fs.mkdtempSync(path.join(os.tmpdir(), "gwork-native-rebuild-"));
    const source = path.join(staging, "package");
    fs.cpSync(packageDir, source, {
      recursive: true,
      dereference: true,
      filter: file => file !== path.join(packageDir, "build"),
    });
    // Header/runtime settings inherited from another npm installation must not
    // override the current process. Keep compiler/Python configuration intact.
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
      !/^(npm_config_|npm_package_config_node_gyp_)(target|arch|nodedir|disturl|dist_url|runtime)$/i.test(name)
    ));
    run(runtime.execPath, [nodeGyp, "rebuild", "--directory", source,
      `--target=${runtime.version}`, `--arch=${runtime.arch}`], { stdio: "inherit", timeout: 120_000, env });
    const binary = path.join(source, "build/Release/better_sqlite3.node");
    // A fresh process avoids CommonJS/native-module caches and checks the exact
    // staged binary using better-sqlite3's supported nativeBinding option.
    const probe = `const Database = require(${JSON.stringify(packageDir)}); new Database(':memory:', { nativeBinding: ${JSON.stringify(binary)} }).close();`;
    run(runtime.execPath, ["--eval", probe], { stdio: "pipe", timeout: 10_000, env });

    const destination = path.join(packageDir, "build/Release");
    fs.mkdirSync(destination, { recursive: true });
    installStaging = fs.mkdtempSync(path.join(destination, ".gwork-native-"));
    const replacement = path.join(installStaging, "better_sqlite3.node");
    fs.copyFileSync(binary, replacement);
    fs.renameSync(replacement, path.join(destination, "better_sqlite3.node"));
    return true;
  } catch (error) {
    console.error(`  Native rebuild failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  } finally {
    for (const directory of [installStaging, staging]) {
      if (directory) {
        try { fs.rmSync(directory, { recursive: true, force: true }); }
        catch { console.error(`  Could not remove temporary build directory: ${directory}`); }
      }
    }
  }
}
