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
import { Logger } from '@nestjs/common';

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
export class CandlesGateway  implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() 
  server: Server;

  private readonly logger = new Logger();
  private readonly moduleName = CandlesGateway.name;

  handleConnection(client: Socket) {
    this.logger.log(`[INFO] [${this.moduleName}] Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`[INFO] [${this.moduleName}] Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join_kline_room')
  handleJoinRoom(
    @MessageBody() payload: { symbol: string; interval: string },
    @ConnectedSocket() client: Socket,
  ) {
    const roomName = `${payload.symbol.toUpperCase()}_${payload.interval}`;
    client.join(roomName);
    this.logger.log(
      `[INFO] [${this.moduleName}] Client ${client.id} joined room: ${roomName}`,
    );
  }

  @SubscribeMessage('leave_kline_room')
  handleLeaveRoom(
    @MessageBody() payload: { symbol: string; interval: string },
    @ConnectedSocket() client: Socket,
  ) {
    const roomName = `${payload.symbol.toUpperCase()}_${payload.interval}`;
    client.leave(roomName);
    this.logger.log(
      `[INFO] [${this.moduleName}] Client ${client.id} left room: ${roomName}`,
    );
  }

  @OnEvent('candle.update')
  handleCandleUpdateEvent(candleData: any) {
    const isFinal = candleData.is_final === true;
    const logLevel = isFinal ? 'log' : 'debug';
    
    const logMessage = isFinal
      ? `[INFO] [${this.moduleName}] Emitting candle update: ${candleData.symbol} [${candleData.interval}]`
      : `[DEBUG] [${this.moduleName}] Emitting candle update: ${candleData.symbol} [${candleData.interval}]`;
    this.logger[logLevel](logMessage, { 
      symbol: candleData.symbol,
      interval: candleData.interval,
      timestamp: candleData.timestamp,
      is_final: candleData.is_final,
      close: candleData.close,
      volume: candleData.volume
    });
    
    // Emit to specific room based on symbol and interval
    const roomName = `${candleData.symbol.toUpperCase()}_${candleData.interval}`;
    this.server.to(roomName).emit('kline_update', candleData);
  }
}
