import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findNodeGyp, rebuildNativeSqlite } from "../../../src/utils/native-sqlite-rebuild.ts";

describe("native SQLite rebuild", () => {
  let directory: string;
  let packageDir: string;
  let installed: string;
  let diagnostic: ReturnType<typeof spyOn>;
  const runtime = { execPath: "/current/node", version: "26.7.0", arch: "arm64" };
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "gwork-rebuild-test-"));
    packageDir = path.join(directory, "package with spaces");
    installed = path.join(packageDir, "build/Release/better_sqlite3.node");
    fs.mkdirSync(path.dirname(installed), { recursive: true });
    fs.writeFileSync(installed, "original binding");
    fs.writeFileSync(path.join(packageDir, "binding.gyp"), "fixture sources");
    diagnostic = spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    diagnostic.mockRestore();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  for (const failure of ["none", "compiler", "verification", "missing-output"] as const) {
    it(`${failure === "none" ? "publishes verified bytes" : `preserves the old binding on ${failure} failure`}`, () => {
      let staging = "";
      const run = mock((_executable: string, args: string[]) => {
        expect(fs.readFileSync(installed, "utf8")).toBe("original binding");
        if (args[0] !== "--eval") {
          staging = args[3]!;
          expect(staging).not.toBe(packageDir);
          expect(fs.readFileSync(path.join(staging, "binding.gyp"), "utf8")).toBe("fixture sources");
          expect(fs.existsSync(path.join(staging, "build"))).toBe(false);
          fs.mkdirSync(path.join(staging, "build/Release"), { recursive: true });
          if (failure !== "missing-output") fs.writeFileSync(path.join(staging, "build/Release/better_sqlite3.node"), "new binding");
          if (failure === "compiler") throw new Error("compiler failed");
        } else {
          expect(args[1]).toContain(JSON.stringify(packageDir));
          expect(args[1]).toContain(JSON.stringify(path.join(staging, "build/Release/better_sqlite3.node")));
          expect(args[1]).toContain("':memory:'");
          if (failure === "verification") throw new Error("NODE_MODULE_VERSION mismatch");
        }
      });
      const success = rebuildNativeSqlite({ packageDir, nodeGyp: "/other/install/node-gyp.js", runtime, run });
      expect(success).toBe(failure === "none");
      expect(run.mock.calls[0]).toEqual([runtime.execPath, ["/other/install/node-gyp.js", "rebuild", "--directory", staging, "--target=26.7.0", "--arch=arm64"], expect.objectContaining({ timeout: 120_000 })]);
      expect(fs.readFileSync(installed, "utf8")).toBe(failure === "none" ? "new binding" : "original binding");
      expect(fs.existsSync(path.dirname(staging))).toBe(false);
      expect(fs.readdirSync(path.dirname(installed))).toEqual(["better_sqlite3.node"]);
      expect(run.mock.calls.every(([executable]) => executable === runtime.execPath)).toBe(true);
    });
  }

  it("does not inherit another npm runtime's header/target settings", () => {
    const saved = process.env["npm_config_nodedir"];
    process.env["npm_config_nodedir"] = "/wrong/node/headers";
    let env: NodeJS.ProcessEnv | undefined;
    try {
      rebuildNativeSqlite({ packageDir, nodeGyp: "/tool.js", runtime, run: (_file, _args, options) => {
        env = options.env;
        throw new Error("stop before compilation");
      } });
      expect(env?.["npm_config_nodedir"]).toBeUndefined();
      expect(fs.readFileSync(installed, "utf8")).toBe("original binding");
    } finally {
      if (saved === undefined) delete process.env["npm_config_nodedir"];
      else process.env["npm_config_nodedir"] = saved;
    }
  });

  it("finds an installed JavaScript tool without executing its shebang", () => {
    const script = path.join(directory, "node-gyp.js");
    fs.writeFileSync(script, "#!/wrong/node\nthrow new Error('must not run during discovery');");
    expect(findNodeGyp(directory)).toBe(fs.realpathSync(script));
  });

  it("fails safely when an explicitly selected build tool cannot start", () => {
    const run = mock(() => { throw new Error("ENOENT: missing node-gyp script"); });
    expect(rebuildNativeSqlite({ packageDir, nodeGyp: "/missing/tool.js", runtime, run })).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(installed, "utf8")).toBe("original binding");
  });

  it("preserves the installed binding and removes staging if atomic publication fails", () => {
    let staging = "";
    const rename = spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("EACCES: cannot replace binding"); });
    try {
      const success = rebuildNativeSqlite({ packageDir, nodeGyp: "/tool.js", runtime, run: (_executable, args) => {
        if (args[0] === "--eval") return;
        staging = args[3]!;
        fs.mkdirSync(path.join(staging, "build/Release"), { recursive: true });
        fs.writeFileSync(path.join(staging, "build/Release/better_sqlite3.node"), "verified replacement");
      } });
      expect(success).toBe(false);
      expect(rename).toHaveBeenCalledTimes(1);
      expect(fs.readFileSync(installed, "utf8")).toBe("original binding");
      expect(fs.existsSync(path.dirname(staging))).toBe(false);
      expect(fs.readdirSync(path.dirname(installed))).toEqual(["better_sqlite3.node"]);
    } finally {
      rename.mockRestore();
    }
  });
});
