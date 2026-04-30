/**
 * Unified Logger Configuration
 * 
 * Format: [LEVEL] [MODULE] Message
 * 
 * Log Levels:
 * - DEBUG: Detailed information for debugging purposes
 * - INFO: General informational messages
 * - WARN: Warning messages for potentially problematic situations
 * - ERROR: Error messages for failed operations
 */

import { Logger as NestLogger } from '@nestjs/common';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export class AppLogger extends NestLogger {
  private moduleName: string;

  constructor(moduleName: string) {
    super(moduleName);
    this.moduleName = moduleName;
  }

  /**
   * Log debug information
   */
  debug(message: string, context?: any) {
    this.formatAndLog('DEBUG', message, context);
  }

  /**
   * Log informational message
   */
  info(message: string, context?: any) {
    this.log(`[INFO] [${this.moduleName}] ${message}`, context);
  }

  /**
   * Log warning message
   */
  warning(message: string, context?: any) {
    this.warn(`[WARN] [${this.moduleName}] ${message}`, context);
  }

  /**
   * Log error message
   */
  failure(message: string, context?: any) {
    this.error(`[ERROR] [${this.moduleName}] ${message}`, context);
  }

  /**
   * Internal formatting method
   */
  private formatAndLog(level: LogLevel, message: string, context?: any) {
    const formattedMessage = `[${level}] [${this.moduleName}] ${message}`;
    
    if (level === 'DEBUG') {
      this.debug(formattedMessage);
    } else if (level === 'WARN') {
      this.warn(formattedMessage);
    } else if (level === 'ERROR') {
      this.error(formattedMessage);
    } else {
      this.log(formattedMessage);
    }

    if (context) {
      console.log('Context:', context);
    }
  }
}
