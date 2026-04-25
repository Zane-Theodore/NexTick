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
    this.pool = new Pool({
        user: this.configService.get('QUESTDB_USER'),
        host: this.configService.get('QUESTDB_HOST'),
        database: this.configService.get('QUESTDB_DB_NAME'),
        password: this.configService.get('QUESTDB_PASSWORD'),
        port: this.configService.get('QUESTDB_PORT'),
    });

    try {
      await this.pool.query('SELECT 1');
      this.logger.log('Database connection established successfully.');
    } catch (error) {
      this.logger.error('Failed to establish database connection.');
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
    this.logger.log('Database connection closed.');
  }

  async query(sqlText: string, params?: any[]) {
    return this.pool.query(sqlText, params);
  }
}
