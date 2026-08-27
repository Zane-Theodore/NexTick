import { ConfigModule } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { CandlesModule } from '@modules/candles/candles.module';
import { DatabaseModule } from '@modules/database/database.module';
import { KafkaModule } from '@modules/kafka/kafka.module';
import { MarketTradesModule } from '@modules/market-trades/market-trades.module';
import { OrderBookModule } from '@modules/order-book/order-book.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: '.env',
      isGlobal: true,
    }),
    EventEmitterModule.forRoot(),
    CandlesModule,
    DatabaseModule,
    KafkaModule,
    MarketTradesModule,
    OrderBookModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
