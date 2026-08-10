import { ConfigService } from '@nestjs/config';
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Pool, types } from 'pg';
import { createLogger } from '../../common/logger';

types.setTypeParser(1114, (value: string) => value);
types.setTypeParser(1184, (value: string) => value);

const RECONNECT_DELAY_MS = 5_000;

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly configService: ConfigService) {}

  private readonly logger = createLogger(DatabaseService.name);
  private pool: Pool;
  private isDatabaseAvailable = false;
  private isShuttingDown = false;
  private reconnectPromise?: Promise<void>;

  onModuleInit() {
    this.logger.info('Initializing database connection...');

    this.pool = new Pool({
      user: this.configService.get('QUESTDB_USER'),
      host: this.configService.get('QUESTDB_HOST'),
      database: this.configService.get('QUESTDB_DB_NAME'),
      password: this.configService.get('QUESTDB_PASSWORD'),
      port: this.configService.get('QUESTDB_PORT'),
      max: this.configService.get('QUESTDB_POOL_MAX'),
      connectionTimeoutMillis: this.configService.get('QUESTDB_POOL_TIMEOUT'),
      idleTimeoutMillis: this.configService.get('QUESTDB_POOL_IDLE_TIMEOUT'),
    });

    this.pool.on('error', (error) => {
      this.isDatabaseAvailable = false;
      this.logger.error('QuestDB pool connection was lost. Reconnecting in the background.', error);
      this.startReconnectLoop();
    });

    this.startReconnectLoop();
  }

  async onModuleDestroy() {
    this.isShuttingDown = true;
    if (this.pool) {
      await this.pool.end();
      this.logger.info('Database connection closed.');
    }
  }

  isAvailable(): boolean {
    return this.isDatabaseAvailable;
  }

  async query(sqlText: string, params?: any[]) {
    this.logger.debug('Executing query', {
      sql: sqlText,
      params,
    });

    try {
      const result = await this.pool.query(sqlText, params);
      this.isDatabaseAvailable = true;

      this.logger.debug('Query executed successfully', {
        rowCount: result.rowCount,
      });

      return result;
    } catch (error) {
      this.isDatabaseAvailable = false;
      this.startReconnectLoop();
      this.logger.error('Query execution failed', error);
      throw error;
    }
  }

  private startReconnectLoop(): void {
    if (this.isShuttingDown || this.reconnectPromise) {
      return;
    }

    this.reconnectPromise = this.waitForDatabase()
      .finally(() => {
        this.reconnectPromise = undefined;
      });
  }

  private async waitForDatabase(): Promise<void> {
    while (!this.isShuttingDown) {
      try {
        await this.pool.query('SELECT 1');
        this.isDatabaseAvailable = true;
        this.logger.info('QuestDB connection is available.');
        return;
      } catch (error) {
        this.isDatabaseAvailable = false;
        this.logger.warn(
          `QuestDB is unavailable. Retrying in ${RECONNECT_DELAY_MS / 1_000}s.`,
          { error: error instanceof Error ? error.message : String(error) },
        );
        await this.waitBeforeRetry();
      }
    }
  }

  private waitBeforeRetry(): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, RECONNECT_DELAY_MS);
      timer.unref();
    });
  }
}
