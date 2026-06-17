import { Logger as NestLogger } from '@nestjs/common';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export class AppLogger extends NestLogger {
  private readonly moduleName: string;

  constructor(moduleName: string) {
    super(moduleName);
    this.moduleName = moduleName;
  }

  debug(message: string, metadata?: unknown) {
    super.debug(this.formatMessage('DEBUG', message, metadata));
  }

  info(message: string, metadata?: unknown) {
    super.log(this.formatMessage('INFO', message, metadata));
  }

  warning(message: string, metadata?: unknown) {
    super.warn(this.formatMessage('WARN', message, metadata));
  }

  failure(message: string, error?: unknown, metadata?: unknown) {
    const payload = this.mergeErrorMetadata(error, metadata);

    if (error instanceof Error) {
      super.error(this.formatMessage('ERROR', message, payload), error.stack);
      return;
    }

    super.error(this.formatMessage('ERROR', message, payload));
  }

  private formatMessage(
    level: LogLevel,
    message: string,
    metadata?: unknown,
  ): string {
    const baseMessage = `[${level}] [${this.moduleName}] ${message}`;

    if (metadata === undefined || metadata === null) {
      return baseMessage;
    }

    return `${baseMessage} ${this.stringify(metadata)}`;
  }

  private mergeErrorMetadata(error?: unknown, metadata?: unknown): unknown {
    if (!error) {
      return metadata;
    }

    const errorMetadata =
      error instanceof Error
        ? {
            error: error.name,
            message: error.message,
          }
        : { error };

    if (!metadata) {
      return errorMetadata;
    }

    return {
      ...errorMetadata,
      metadata,
    };
  }

  private stringify(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      if (value === null || value === undefined) {
        return '';
      }

      if (typeof value === 'object' || typeof value === 'function') {
        return '[Unserializable metadata]';
      }

      switch (typeof value) {
        case 'string':
          return value;
        case 'number':
        case 'bigint':
        case 'boolean':
        case 'symbol':
          return value.toString();
        default:
          return '';
      }
    }
  }
}
