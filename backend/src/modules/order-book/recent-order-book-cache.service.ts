import { Injectable } from '@nestjs/common';
import {
  getOrderBookRoomKey,
  OrderBookUpdate,
} from './market-depth-normalization';

@Injectable()
export class RecentOrderBookCacheService {
  private readonly snapshotsByRoom = new Map<string, OrderBookUpdate>();

  upsert(snapshot: OrderBookUpdate): void {
    const roomKey = getOrderBookRoomKey(snapshot.symbol);
    const currentSnapshot = this.snapshotsByRoom.get(roomKey);

    if (
      currentSnapshot &&
      currentSnapshot.lastUpdateId > snapshot.lastUpdateId
    ) {
      return;
    }

    this.snapshotsByRoom.set(roomKey, snapshot);
  }

  getSnapshot(symbol: string): OrderBookUpdate | null {
    return this.snapshotsByRoom.get(getOrderBookRoomKey(symbol)) ?? null;
  }
}
