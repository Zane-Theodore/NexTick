import { Module } from '@nestjs/common';
import { MarketTradesGateway } from './market-trades.gateway';
import { RecentMarketTradesCacheService } from './recent-market-trades-cache.service';

@Module({
  providers: [MarketTradesGateway, RecentMarketTradesCacheService],
})
export class MarketTradesModule {}
