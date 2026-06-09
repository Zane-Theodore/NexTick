import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CandlesService } from './candles.service';
import { CandlesController } from './candles.controller';
import { CandlesGateway } from './candles.gateway';
import { RecentCandlesCacheService } from './recent-candles-cache.service';

@Module({
  imports: [DatabaseModule],
  controllers: [CandlesController],
  providers: [CandlesService, CandlesGateway, RecentCandlesCacheService],
})
export class CandlesModule {}
