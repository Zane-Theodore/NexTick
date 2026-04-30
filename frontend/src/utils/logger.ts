/**
 * Unified Frontend Logger
 * 
 * Format: [LEVEL] [MODULE] Message
 * 
 * Log Levels:
 * - DEBUG: Detailed information for debugging purposes
 * - INFO: General informational messages
 * - WARN: Warning messages for potentially problematic situations
 * - ERROR: Error messages for failed operations
 * 
 * No emojis, icons, or special characters are used in log messages
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export class Logger {
  private moduleName: string;
  private isDevelopment: boolean;

  constructor(moduleName: string) {
    this.moduleName = moduleName;
    this.isDevelopment = import.meta.env.DEV;
  }

  /**
   * Log debug information (only in development)
   */
  debug(message: string, context?: any) {
    if (this.isDevelopment) {
      this.formatAndLog('DEBUG', message, context);
    }
  }

  /**
   * Log informational message
   */
  info(message: string, context?: any) {
    this.formatAndLog('INFO', message, context);
  }

  /**
   * Log warning message
   */
  warn(message: string, context?: any) {
    this.formatAndLog('WARN', message, context);
  }

  /**
   * Log error message
   */
  error(message: string, context?: any) {
    this.formatAndLog('ERROR', message, context);
  }

  /**
   * Internal formatting method
   */
  private formatAndLog(level: LogLevel, message: string, context?: any) {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${level}] [${this.moduleName}] ${message}`;

    // Use appropriate console method based on level
    const logFn =
      level === 'ERROR'
        ? console.error
        : level === 'WARN'
          ? console.warn
          : level === 'DEBUG'
            ? console.debug
            : console.log;

    if (context !== undefined) {
      logFn(formattedMessage, context);
    } else {
      logFn(formattedMessage);
    }
  }
}

// Create a singleton instance for common use
export const createLogger = (moduleName: string) => new Logger(moduleName);
