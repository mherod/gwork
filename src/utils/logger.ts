/**
 * Unified logging configuration for gwork CLI.
 * Provides consistent logging interface across all commands and services.
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

/**
 * Shared Logger interface used across commands and services.
 * The singleton `logger` instance implements this interface and respects
 * --quiet / --verbose flags configured via `logger.configure()`.
 */
export interface Logger {
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  info(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

interface LoggerConfig {
  level: LogLevel;
  quiet: boolean;
  verbose: boolean;
}

class LoggerImpl implements Logger {
  private config: LoggerConfig = {
    level: 'info',
    quiet: false,
    verbose: false,
  };

  /**
   * Configure the logger globally.
   */
  configure(config: Partial<LoggerConfig>) {
    this.config = { ...this.config, ...config };
    if (config.verbose) {
      this.config.level = 'debug';
    } else if (config.quiet) {
      this.config.level = 'error';
    }
  }

  /**
   * Get current configuration.
   */
  getConfig(): LoggerConfig {
    return { ...this.config };
  }

  /**
   * Log error message (always shown).
   */
  error(...args: unknown[]): void {
    if (!this.config.quiet) {
      console.error(...args);
    }
  }

  /**
   * Log warning message (shown unless quiet).
   */
  warn(...args: unknown[]): void {
    if (this.config.level !== 'error' && !this.config.quiet) {
      console.warn(...args);
    }
  }

  /**
   * Log info message (shown by default).
   */
  info(...args: unknown[]): void {
    if (this.config.level !== 'error' && !this.config.quiet) {
      console.log(...args);
    }
  }

  /**
   * Log debug message (shown only with --verbose).
   */
  debug(...args: unknown[]): void {
    if (this.config.verbose) {
      console.log('[DEBUG]', ...args);
    }
  }

  /**
   * Log regular output (always shown unless quiet).
   * Alias for info() for backwards compatibility.
   */
  log(...args: unknown[]): void {
    this.info(...args);
  }
}

// Export singleton instance
export const logger = new LoggerImpl();
