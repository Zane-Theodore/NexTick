import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { OnEvent } from '@nestjs/event-emitter';
import { UsePipes, ValidationPipe } from '@nestjs/common';
import { KlineRoomPayloadDto } from './dto/kline-room-payload.dto';
import { KlineUpdateDto } from './dto/kline-update.dto';
import { AppLogger } from '../../common/logger';
import { RecentCandlesCacheService } from './recent-candles-cache.service';
import { isValidCandleOhlcv } from './candle-validation';

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
export class CandlesGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new AppLogger(CandlesGateway.name);

  constructor(private readonly recentCandlesCache: RecentCandlesCacheService) {}

  handleConnection(client: Socket) {
    this.logger.info(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.info(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join_kline_room')
  handleJoinRoom(
    @MessageBody() payload: KlineRoomPayloadDto,
    @ConnectedSocket() client: Socket,
  ) {
    const interval = payload.interval ?? '1m';
    const roomName = `${payload.symbol.toUpperCase()}_${interval}`;
    client.join(roomName);
    this.logger.info(`Client ${client.id} joined room: ${roomName}`);

    const cachedCandles = this.recentCandlesCache.getKlineUpdates(
      payload.symbol,
      interval,
    );

    cachedCandles.forEach((candle) => {
      client.emit('kline_update', candle);
    });
  }

  @SubscribeMessage('leave_kline_room')
  handleLeaveRoom(
    @MessageBody() payload: KlineRoomPayloadDto,
    @ConnectedSocket() client: Socket,
  ) {
    const interval = payload.interval ?? '1m';
    const roomName = `${payload.symbol.toUpperCase()}_${interval}`;
    client.leave(roomName);
    this.logger.info(`Client ${client.id} left room: ${roomName}`);
  }

  @OnEvent('candle.update')
  handleCandleUpdateEvent(candleData: KlineUpdateDto) {
    if (!isValidCandleOhlcv(candleData)) {
      this.logger.warning('Invalid candle update skipped before websocket emit', {
        symbol: candleData.symbol,
        interval: candleData.interval,
        timestamp: candleData.timestamp,
        open: candleData.open,
        high: candleData.high,
        low: candleData.low,
        close: candleData.close,
        volume: candleData.volume,
      });
      return;
    }

    const isFinal = candleData.is_final === true;
    this.recentCandlesCache.upsert(candleData);

    const logMessage = isFinal
      ? `Emitting candle update: ${candleData.symbol} [${candleData.interval}]`
      : `Emitting updating candle: ${candleData.symbol} [${candleData.interval}]`;
    const logMetadata = {
      symbol: candleData.symbol,
      interval: candleData.interval,
      timestamp: candleData.timestamp,
      is_final: candleData.is_final,
      close: candleData.close,
      volume: candleData.volume,
    };

    if (isFinal) {
      this.logger.info(logMessage, logMetadata);
    } else {
      this.logger.debug(logMessage, logMetadata);
    }

    // Emit to specific room based on symbol and interval
    const roomName = `${candleData.symbol.toUpperCase()}_${candleData.interval}`;
    this.server.to(roomName).emit('kline_update', candleData);
  }
}
