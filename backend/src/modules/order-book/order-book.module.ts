import { Module } from '@nestjs/common';
import { OrderBookGateway } from './order-book.gateway';
import { RecentOrderBookCacheService } from './recent-order-book-cache.service';

@Module({
  providers: [OrderBookGateway, RecentOrderBookCacheService],
})
export class OrderBookModule {}
