import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

import { CandlesModule } from '@modules/candles/candles.module';
import { DatabaseModule } from '@modules/database/database.module';
import { KafkaModule } from '@modules/kafka/kafka.module';

@Module({
  imports: [CandlesModule, DatabaseModule, KafkaModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
