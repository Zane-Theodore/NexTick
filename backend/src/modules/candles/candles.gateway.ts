import { 
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
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
    
    // Emit unified event to all connected clients
    this.server.emit('candle.update', candleData);
    
    // Also emit interval-specific event for targeted subscriptions
    const intervalKey = `candle.update.${candleData.symbol}.${candleData.interval}`;
    this.server.emit(intervalKey, candleData);
  }
}
