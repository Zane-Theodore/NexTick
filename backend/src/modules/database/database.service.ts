import { ConfigService } from '@nestjs/config';
import { 
  Injectable, 
  Logger, 
  OnModuleInit, 
  OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly configService: ConfigService) {}

  private readonly logger = new Logger(DatabaseService.name);
  private pool: Pool;

  async onModuleInit() {
    this.logger.log('[DB_INIT] Initializing database connection...');

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

    try {
      await this.pool.query('SELECT 1');
      this.logger.log('[DB_INIT_SUCCESS] Database connection established successfully.');
    } catch (error) {
      this.logger.error('[DB_INIT_ERROR] Failed to establish database connection.');
      throw error;
    }
  }

  async onModuleDestroy() {
    if (this.pool) {
      await this.pool.end();
      this.logger.log('[DB_DESTROY] Database connection closed.');
    }
  }

  async query(sqlText: string, params?: any[]) {
    this.logger.debug('[DB_QUERY] Executing query', {
      sql: sqlText,
      params,
    });

    try {
      const result = await this.pool.query(sqlText, params);

      this.logger.debug('[DB_QUERY_SUCCESS] Query executed successfully', {
        rowCount: result.rowCount,
      });

      return result;
    } catch (error) {
      this.logger.error('[DB_QUERY_ERROR] Query execution failed');
      throw error;
    }
  }
}
