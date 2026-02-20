import { ArgumentError } from "../services/errors.ts";

type CommandFn<S> = (service: S, args: string[]) => Promise<void>;

/**
 * Generic command registry that maps subcommand names to handler functions.
 * Replaces switch-based dispatch — adding a new subcommand only requires
 * calling .register(), never editing the dispatcher.
 */
export class CommandRegistry<S> {
  private handlers = new Map<string, CommandFn<S>>();

  register(name: string, fn: CommandFn<S>): this {
    this.handlers.set(name, fn);
    return this;
  }

  async execute(name: string, service: S, args: string[]): Promise<void> {
    const fn = this.handlers.get(name);
    if (!fn) {
      throw new ArgumentError(
        `Unknown subcommand: ${name}`,
        [...this.handlers.keys()].join(", ")
      );
    }
    return fn(service, args);
  }

  commands(): string[] {
    return [...this.handlers.keys()];
  }
}
