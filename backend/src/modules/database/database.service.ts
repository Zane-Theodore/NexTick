import { ConfigService } from '@nestjs/config';
import { 
  Injectable, 
  OnModuleInit, 
  OnModuleDestroy } from '@nestjs/common';
import { Pool, types } from 'pg';
import { AppLogger } from '../../common/logger';

types.setTypeParser(1114, (value: string) => value);
types.setTypeParser(1184, (value: string) => value);

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly configService: ConfigService) {}

  private readonly logger = new AppLogger(DatabaseService.name);
  private pool: Pool;

  async onModuleInit() {
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

    try {
      await this.pool.query('SELECT 1');
      this.logger.info('Database connection established successfully.');
    } catch (error) {
      this.logger.failure('Failed to establish database connection.', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    if (this.pool) {
      await this.pool.end();
      this.logger.info('Database connection closed.');
    }
  }

  async query(sqlText: string, params?: any[]) {
    this.logger.debug('Executing query', {
      sql: sqlText,
      params,
    });

    try {
      const result = await this.pool.query(sqlText, params);

      this.logger.debug('Query executed successfully', {
        rowCount: result.rowCount,
      });

      return result;
    } catch (error) {
      this.logger.failure('Query execution failed', error);
      throw error;
    }
  }
}
