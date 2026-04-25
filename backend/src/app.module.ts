import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { CandlesModule } from '@modules/candles/candles.module';
import { DatabaseModule } from '@modules/database/database.module';
import { KafkaModule } from '@modules/kafka/kafka.module';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    CandlesModule, 
    DatabaseModule, 
    KafkaModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
