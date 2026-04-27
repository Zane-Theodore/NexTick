import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CandlesService } from './candles.service';
import { CandlesController } from './candles.controller';
import { CandlesGateway } from './candles.gateway';

@Module({
  imports: [DatabaseModule],
  controllers: [CandlesController],
  providers: [CandlesService, CandlesGateway],
})
export class CandlesModule {}
