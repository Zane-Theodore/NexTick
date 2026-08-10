import { Injectable } from '@nestjs/common';
import { DatabaseService } from './modules/database/database.service';
import { KafkaService } from './modules/kafka/kafka.service';

@Injectable()
export class AppService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly kafkaService: KafkaService,
  ) {}

  getHello(): string {
    return 'Hello World!';
  }

  getHealth() {
    const dependencies = {
      questdb: this.databaseService.isAvailable(),
      kafka: this.kafkaService.isAvailable(),
    };

    return {
      status: Object.values(dependencies).every(Boolean) ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      dependencies,
    };
  }
}
