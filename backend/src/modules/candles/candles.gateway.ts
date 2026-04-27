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
  cors: { origin: '*' },
})
export class CandlesGateway  implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() 
  server: Server;

  private readonly logger = new Logger(CandlesGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`[WS_CONNECT] Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`[WS_DISCONNECT] Client disconnected: ${client.id}`);
  }

  @OnEvent('candle.created')
  handleCandleCreatedEvent(candleData: any) {
    this.logger.debug('[WS_EVENT] Emitting candle.created event to clients', { candleData });
    this.server.emit('candle.created', candleData);
  }
}
