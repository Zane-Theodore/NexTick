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

@WebSocketGateway({
  cors: { 
    origin: [
      'http://localhost:3000',
      'http://localhost:5173',
    ],
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
export class CandlesGateway  implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() 
  server: Server;

  private readonly logger = new AppLogger(CandlesGateway.name);

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
    const roomName = `${payload.symbol.toUpperCase()}_${payload.interval}`;
    client.join(roomName);
    this.logger.info(`Client ${client.id} joined room: ${roomName}`);
  }

  @SubscribeMessage('leave_kline_room')
  handleLeaveRoom(
    @MessageBody() payload: KlineRoomPayloadDto,
    @ConnectedSocket() client: Socket,
  ) {
    const roomName = `${payload.symbol.toUpperCase()}_${payload.interval}`;
    client.leave(roomName);
    this.logger.info(`Client ${client.id} left room: ${roomName}`);
  }

  @OnEvent('candle.update')
  handleCandleUpdateEvent(candleData: KlineUpdateDto) {
    const isFinal = candleData.is_final === true;
    
    const logMessage = isFinal
      ? `Emitting candle update: ${candleData.symbol} [${candleData.interval}]`
      : `Emitting updating candle: ${candleData.symbol} [${candleData.interval}]`;
    const logMetadata = { 
      symbol: candleData.symbol,
      interval: candleData.interval,
      timestamp: candleData.timestamp,
      is_final: candleData.is_final,
      close: candleData.close,
      volume: candleData.volume
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
