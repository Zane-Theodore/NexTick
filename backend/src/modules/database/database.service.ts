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

  private readonly logger = new Logger();
  private readonly moduleName = DatabaseService.name;
  private pool: Pool;

  async onModuleInit() {
    this.logger.log(`[INFO] [${this.moduleName}] Initializing database connection...`);

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
      this.logger.log(`[INFO] [${this.moduleName}] Database connection established successfully.`);
    } catch (error) {
      this.logger.error(`[ERROR] [${this.moduleName}] Failed to establish database connection.`);
      throw error;
    }
  }

  async onModuleDestroy() {
    if (this.pool) {
      await this.pool.end();
      this.logger.log(`[INFO] [${this.moduleName}] Database connection closed.`);
    }
  }

  async query(sqlText: string, params?: any[]) {
    this.logger.debug(`[DEBUG] [${this.moduleName}] Executing query`, {
      sql: sqlText,
      params,
    });

    try {
      const result = await this.pool.query(sqlText, params);

      this.logger.debug(`[DEBUG] [${this.moduleName}] Query executed successfully`, {
        rowCount: result.rowCount,
      });

      return result;
    } catch (error) {
      this.logger.error(`[ERROR] [${this.moduleName}] Query execution failed`);
      throw error;
    }
  }
}
