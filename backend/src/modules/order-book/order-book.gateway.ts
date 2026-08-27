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
import { OrderBookRoomPayloadDto } from './dto/order-book-room-payload.dto';
import {
  getOrderBookRoomKey,
  OrderBookUpdate,
} from './market-depth-normalization';
import { RecentOrderBookCacheService } from './recent-order-book-cache.service';

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
export class OrderBookGateway {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly recentOrderBookCache: RecentOrderBookCacheService,
  ) {}

  @SubscribeMessage('join_order_book_room')
  handleJoinRoom(
    @MessageBody() payload: OrderBookRoomPayloadDto,
    @ConnectedSocket() client: Socket,
  ) {
    const roomName = getOrderBookRoomKey(payload.symbol);
    void client.join(roomName);

    const snapshot = this.recentOrderBookCache.getSnapshot(payload.symbol);
    if (snapshot) {
      client.emit('order_book_snapshot', snapshot);
    }
  }

  @SubscribeMessage('leave_order_book_room')
  handleLeaveRoom(
    @MessageBody() payload: OrderBookRoomPayloadDto,
    @ConnectedSocket() client: Socket,
  ) {
    void client.leave(getOrderBookRoomKey(payload.symbol));
  }

  @OnEvent('market-depth.update')
  handleMarketDepthUpdate(snapshot: OrderBookUpdate) {
    this.recentOrderBookCache.upsert(snapshot);
    this.server
      .to(getOrderBookRoomKey(snapshot.symbol))
      .emit('order_book_update', snapshot);
  }
}
