import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Kafka, Consumer } from 'kafkajs';
import { 
    Injectable,
    Logger,
    OnModuleInit,
    OnModuleDestroy } from '@nestjs/common';

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaService.name);
  private kafka: Kafka;
  private candleConsumer: Consumer;
  private tradeConsumer: Consumer;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async onModuleInit() {
    this.logger.log('[KAFKA_INIT] Initializing Kafka consumers...');

    this.kafka = new Kafka({
      clientId: this.configService.get<string>('KAFKA_CLIENT_ID'),
      brokers: this.configService.get<string>('KAFKA_BROKER').split(','),
    });

    // Consumer cho completed candles (1 phút)
    await this.initCandleConsumer();
    
    // Consumer cho raw trades (real-time)
    await this.initTradeConsumer();

    this.logger.log('[KAFKA_INIT_SUCCESS] All Kafka consumers initialized and running.');
  }

  private async initCandleConsumer() {
    this.candleConsumer = this.kafka.consumer({ 
      groupId: this.configService.get<string>('KAFKA_GROUP_ID') 
    });

    try {
      await this.candleConsumer.connect();
      await this.candleConsumer.subscribe({ 
        topic: this.configService.get<string>('KAFKA_TOPIC_PROCESSED_CANDLES'), 
        fromBeginning: false 
      });

      await this.candleConsumer.run({
        eachMessage: async ({ message }) => {
          const rawValue = message.value?.toString();
          if (!rawValue) {
            this.logger.warn('[CANDLE_MESSAGE_WARNING] Received message with empty value.');
            return;
          }

          try {
            const candleData = JSON.parse(rawValue);
            this.logger.debug('[CANDLE_MESSAGE_RECEIVED] Completed candle received', { candleData });

            this.eventEmitter.emit('candle.created', candleData);
          } catch (error) {
            this.logger.error('[CANDLE_MESSAGE_ERROR] Failed to parse message value.', { error, rawValue });
          }
        },
      });

      this.logger.log('[CANDLE_CONSUMER_INIT_SUCCESS] Candle consumer initialized.');
    } catch (error) {
      this.logger.error('[CANDLE_CONSUMER_INIT_ERROR] Failed to initialize candle consumer.');
      throw error;
    }
  }

  private async initTradeConsumer() {
    this.tradeConsumer = this.kafka.consumer({ 
      groupId: `${this.configService.get<string>('KAFKA_GROUP_ID')}-trades` 
    });

    try {
      await this.tradeConsumer.connect();
      await this.tradeConsumer.subscribe({ 
        topic: this.configService.get<string>('KAFKA_TOPIC_RAW_TRADES') || 'raw-trades', 
        fromBeginning: false 
      });

      await this.tradeConsumer.run({
        eachMessage: async ({ message }) => {
          const rawValue = message.value?.toString();
          if (!rawValue) {
            this.logger.warn('[TRADE_MESSAGE_WARNING] Received message with empty value.');
            return;
          }

          try {
            const tradeData = JSON.parse(rawValue);
            this.logger.debug('[TRADE_MESSAGE_RECEIVED] Raw trade received', { 
              price: tradeData.price, 
              volume: tradeData.volume 
            });

            this.eventEmitter.emit('trade.raw', tradeData);
          } catch (error) {
            this.logger.error('[TRADE_MESSAGE_ERROR] Failed to parse trade message.', { error, rawValue });
          }
        },
      });

      this.logger.log('[TRADE_CONSUMER_INIT_SUCCESS] Trade consumer initialized.');
    } catch (error) {
      this.logger.error('[TRADE_CONSUMER_INIT_ERROR] Failed to initialize trade consumer.');
      throw error;
    }
  }

  async onModuleDestroy() {
    this.logger.log('[KAFKA_DESTROY] Disconnecting Kafka consumers...');
    if (this.candleConsumer) {
      await this.candleConsumer.disconnect();
    }
    if (this.tradeConsumer) {
      await this.tradeConsumer.disconnect();
    }
    this.logger.log('[KAFKA_DESTROY_SUCCESS] All Kafka consumers disconnected.');
  }
}
