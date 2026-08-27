import { UsePipes, ValidationPipe } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { MarketTradeRoomPayloadDto } from './dto/market-trade-room-payload.dto';
import {
  getMarketTradesRoomKey,
  MarketTradeUpdate,
} from './market-trade-normalization';
import { RecentMarketTradesCacheService } from './recent-market-trades-cache.service';

@WebSocketGateway({
  cors: {
    origin: (origin, callback) => {
      const allowedOrigins = [
        process.env.BACKEND_URL,
        process.env.FRONTEND_URL,
      ];

      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true,
})
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
  }),
)
export class MarketTradesGateway {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly recentMarketTradesCache: RecentMarketTradesCacheService,
  ) {}

  @SubscribeMessage('join_market_trades_room')
  handleJoinRoom(
    @MessageBody() payload: MarketTradeRoomPayloadDto,
    @ConnectedSocket() client: Socket,
  ) {
    const roomName = getMarketTradesRoomKey(payload.symbol);
    void client.join(roomName);
    client.emit(
      'market_trades_snapshot',
      this.recentMarketTradesCache.getRecent(payload.symbol),
    );
  }

  @SubscribeMessage('leave_market_trades_room')
  handleLeaveRoom(
    @MessageBody() payload: MarketTradeRoomPayloadDto,
    @ConnectedSocket() client: Socket,
  ) {
    void client.leave(getMarketTradesRoomKey(payload.symbol));
  }

  @OnEvent('market-trade.update')
  handleMarketTradeUpdate(trade: MarketTradeUpdate) {
    this.recentMarketTradesCache.upsert(trade);
    this.server
      .to(getMarketTradesRoomKey(trade.symbol))
      .emit('market_trade', trade);
  }
}
