import { Module } from '@nestjs/common';
import { CandlesService } from './candles.service';
import { CandlesController } from './candles.controller';
import { CandlesGateway } from './candles.gateway';

@Module({
  controllers: [CandlesController],
  providers: [CandlesService, CandlesGateway],
})
export class CandlesModule {}
