/**
 * Unit tests for CommandRegistry.
 *
 * CommandRegistry is the shared dispatch layer used by every command handler
 * (cal, mail, drive, contacts). It maps subcommand names to handler functions
 * and throws ArgumentError with a hint listing valid subcommands when an
 * unknown name is passed.
 */

import { describe, it, expect } from "bun:test";
import { CommandRegistry } from "../../../src/commands/registry.ts";
import { ArgumentError } from "../../../src/services/errors.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type StubService = { name: string };

function makeRegistry() {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const registry = new CommandRegistry<StubService>()
    .register("foo", async (_svc, args) => { calls.push({ cmd: "foo", args }); })
    .register("bar", async (_svc, args) => { calls.push({ cmd: "bar", args }); });
  return { registry, calls };
}

const stubService: StubService = { name: "test" };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CommandRegistry", () => {
  describe("execute — known subcommands", () => {
    it("calls the handler registered for the given name", async () => {
      const { registry, calls } = makeRegistry();
      await registry.execute("foo", stubService, []);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.cmd).toBe("foo");
    });

    it("passes args through to the handler unchanged", async () => {
      const { registry, calls } = makeRegistry();
      await registry.execute("bar", stubService, ["--flag", "value"]);
      expect(calls[0]?.args).toEqual(["--flag", "value"]);
    });

    it("calls the correct handler when multiple are registered", async () => {
      const { registry, calls } = makeRegistry();
      await registry.execute("bar", stubService, []);
      expect(calls[0]?.cmd).toBe("bar");
    });
  });

  describe("execute — unknown subcommand", () => {
    it("throws ArgumentError for an unregistered name", async () => {
      const { registry } = makeRegistry();
      let caught: unknown;
      try {
        await registry.execute("unknown", stubService, []);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ArgumentError);
    });

    it("includes the unknown subcommand name in the error message", async () => {
      const { registry } = makeRegistry();
      let caught: unknown;
      try {
        await registry.execute("unknown", stubService, []);
      } catch (e) {
        caught = e;
      }
      expect((caught as ArgumentError).message).toContain("unknown");
    });

    it("includes registered command names in the error message as a usage hint", async () => {
      const { registry } = makeRegistry();
      let caught: unknown;
      try {
        await registry.execute("nope", stubService, []);
      } catch (e) {
        caught = e;
      }
      // ArgumentError embeds the usage string (command list) into message as "Usage: foo, bar"
      const msg = (caught as ArgumentError).message;
      expect(msg).toContain("foo");
      expect(msg).toContain("bar");
    });
  });

  describe("register — fluent chaining", () => {
    it("returns the registry instance for chaining", () => {
      const registry = new CommandRegistry<StubService>();
      const returned = registry.register("cmd", async () => {});
      expect(returned).toBe(registry);
    });

    it("overwrites a handler when the same name is registered twice", async () => {
      const calls: string[] = [];
      const registry = new CommandRegistry<StubService>()
        .register("cmd", async () => { calls.push("first"); })
        .register("cmd", async () => { calls.push("second"); });
      await registry.execute("cmd", stubService, []);
      expect(calls).toEqual(["second"]);
    });
  });

  describe("commands()", () => {
    it("returns all registered command names", () => {
      const { registry } = makeRegistry();
      const names = registry.commands();
      expect(names).toContain("foo");
      expect(names).toContain("bar");
    });

    it("returns an empty array when no commands are registered", () => {
      const registry = new CommandRegistry<StubService>();
      expect(registry.commands()).toEqual([]);
    });

    it("reflects commands added after construction", () => {
      const registry = new CommandRegistry<StubService>();
      registry.register("late", async () => {});
      expect(registry.commands()).toContain("late");
    });
  });
});
