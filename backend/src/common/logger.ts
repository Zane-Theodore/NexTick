import type { LoggerService } from '@nestjs/common';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

/**
 * Application logger used by both application code and NestJS runtime logs.
 *
 * Public methods follow the same vocabulary as the frontend logger:
 * debug, info, warn and error.
 */
export class AppLogger implements LoggerService {
  constructor(
    private readonly moduleName = 'Application',
    private readonly isDevelopment = process.env.NODE_ENV !== 'production',
  ) {}

  debug(message: unknown, metadata?: unknown): void {
    if (this.isDevelopment) {
      this.write('DEBUG', message, metadata);
    }
  }

  info(message: unknown, metadata?: unknown): void {
    this.write('INFO', message, metadata);
  }

  warn(message: unknown, metadata?: unknown): void {
    this.write('WARN', message, metadata);
  }

  error(message: unknown, error?: unknown, metadata?: unknown): void {
    this.write('ERROR', message, metadata, error);
  }

  // NestJS LoggerService compatibility. Application code should use info().
  log(message: unknown, metadata?: unknown): void {
    this.info(message, metadata);
  }

  verbose(message: unknown, metadata?: unknown): void {
    this.debug(message, metadata);
  }

  fatal(message: unknown, error?: unknown, metadata?: unknown): void {
    this.error(message, error, metadata);
  }

  private write(
    level: LogLevel,
    message: unknown,
    metadata?: unknown,
    error?: unknown,
  ): void {
    const details = this.mergeErrorMetadata(error, metadata);
    const formattedMessage = `[${new Date().toISOString()}] [${level}] [${this.moduleName}] ${this.stringify(message)}`;
    const log =
      level === 'ERROR'
        ? console.error
        : level === 'WARN'
          ? console.warn
          : level === 'DEBUG'
            ? console.debug
            : console.info;

    if (details === undefined) {
      log(formattedMessage);
      return;
    }

    log(formattedMessage, details);
  }

  private mergeErrorMetadata(error?: unknown, metadata?: unknown): unknown {
    if (error === undefined) {
      return metadata;
    }

    const errorDetails =
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
        : error;

    if (metadata === undefined) {
      return { error: errorDetails };
    }

    return { error: errorDetails, metadata };
  }

  private stringify(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }

    const serialized = this.serialize(value);
    if (serialized !== undefined) {
      return serialized;
    }

    if (value === null) {
      return 'null';
    }

    switch (typeof value) {
      case 'number':
      case 'bigint':
      case 'boolean':
      case 'symbol':
      case 'undefined':
        return String(value);
      default:
        return '[Unserializable value]';
    }
  }

  private serialize(value: unknown): string | undefined {
    const visited = new WeakSet<object>();

    try {
      return JSON.stringify(value, (_key, currentValue: unknown) => {
        if (typeof currentValue === 'bigint') {
          return currentValue.toString();
        }

        if (currentValue instanceof Error) {
          return {
            name: currentValue.name,
            message: currentValue.message,
            stack: currentValue.stack,
          };
        }

        if (typeof currentValue === 'object' && currentValue !== null) {
          if (visited.has(currentValue)) {
            return '[Circular]';
          }

          visited.add(currentValue);
        }

        return currentValue;
      });
    } catch {
      return undefined;
    }
  }
}

export const createLogger = (moduleName: string): AppLogger =>
  new AppLogger(moduleName);
