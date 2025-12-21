/**
 * Logger interface and console implementation.
 * Decouples services from console.log to enable structured logging.
 */

export interface Logger {
  info(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  error(message: string, meta?: any): void;
  debug(message: string, meta?: any): void;
}

/**
 * Simple console-based logger implementation.
 * Debug messages only shown when DEBUG environment variable is set.
 */
export class ConsoleLogger implements Logger {
  info(message: string, meta?: any): void {
    if (meta) {
      console.log(message, JSON.stringify(meta));
    } else {
      console.log(message);
    }
  }

  warn(message: string, meta?: any): void {
    if (meta) {
      console.warn(message, JSON.stringify(meta));
    } else {
      console.warn(message);
    }
  }

  error(message: string, meta?: any): void {
    if (meta) {
      console.error(message, JSON.stringify(meta));
    } else {
      console.error(message);
    }
  }

  debug(message: string, meta?: any): void {
    if (process.env["DEBUG"]) {
      if (meta) {
        console.debug(message, JSON.stringify(meta));
      } else {
        console.debug(message);
      }
    }
  }
}

export const defaultLogger = new ConsoleLogger();
