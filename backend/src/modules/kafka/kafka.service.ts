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
  private updatingCandleConsumer: Consumer;

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

    // Consumer cho completed candles (1 minute)
    await this.initCandleConsumer();

    // Consumer cho updating candles (500ms)
    await this.initUpdatingCandleConsumer();

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

  private async initUpdatingCandleConsumer() {
    this.updatingCandleConsumer = this.kafka.consumer({ 
      groupId: `${this.configService.get<string>('KAFKA_GROUP_ID')}-updating-candles` 
    });

    try {
      await this.updatingCandleConsumer.connect();
      await this.updatingCandleConsumer.subscribe({ 
        topic: this.configService.get<string>('KAFKA_TOPIC_UPDATING_CANDLES') || 'updating-candles', 
        fromBeginning: false 
      });

      await this.updatingCandleConsumer.run({
        eachMessage: async ({ message }) => {
          const rawValue = message.value?.toString();
          if (!rawValue) {
            this.logger.warn('[UPDATING_CANDLE_MESSAGE_WARNING] Received message with empty value.');
            return;
          }

          try {
            const updatingCandleData = JSON.parse(rawValue);
            
            if (!updatingCandleData.open || !updatingCandleData.high || !updatingCandleData.low || !updatingCandleData.close) {
              this.logger.error('[UPDATING_CANDLE_VALIDATION_ERROR] Invalid candle data received', { 
                symbol: updatingCandleData.symbol,
                open: updatingCandleData.open,
                high: updatingCandleData.high,
                low: updatingCandleData.low,
                close: updatingCandleData.close,
                volume: updatingCandleData.volume
              });
              return;
            }
            
            this.logger.debug('[UPDATING_CANDLE_MESSAGE_RECEIVED] Updating candle received', { 
              symbol: updatingCandleData.symbol,
              close: updatingCandleData.close,
              volume: updatingCandleData.volume
            });

            this.eventEmitter.emit('candle.updating', updatingCandleData);
          } catch (error) {
            this.logger.error('[UPDATING_CANDLE_MESSAGE_ERROR] Failed to parse message value.', { error, rawValue });
          }
        },
      });

      this.logger.log('[UPDATING_CANDLE_CONSUMER_INIT_SUCCESS] Updating candle consumer initialized.');
    } catch (error) {
      this.logger.error('[UPDATING_CANDLE_CONSUMER_INIT_ERROR] Failed to initialize updating candle consumer.');
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
    if (this.updatingCandleConsumer) {
      await this.updatingCandleConsumer.disconnect();
    }
    this.logger.log('[KAFKA_DESTROY_SUCCESS] All Kafka consumers disconnected.');
  }
}
