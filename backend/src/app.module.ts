import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CandlesModule } from './candles/candles.module';

@Module({
  imports: [CandlesModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
