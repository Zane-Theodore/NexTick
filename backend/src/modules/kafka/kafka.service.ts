import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Kafka, Consumer } from 'kafkajs';
import { 
    Injectable,
    OnModuleInit,
    OnModuleDestroy } from '@nestjs/common';
import { AppLogger } from '../../common/logger';

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new AppLogger(KafkaService.name);
  private kafka: Kafka;
  private klineStreamConsumer: Consumer;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async onModuleInit() {
    this.logger.info('Initializing Kafka consumers...');

    this.kafka = new Kafka({
      clientId: this.configService.get<string>('KAFKA_CLIENT_ID'),
      brokers: this.configService.get<string>('KAFKA_BROKER').split(','),
    });

    // Single unified consumer for kline stream (contains both final and updating candles)
    await this.initKlineStreamConsumer();

    this.logger.info('Kafka kline stream consumer initialized and running.');
  }

  private async initKlineStreamConsumer() {
    this.klineStreamConsumer = this.kafka.consumer({ 
      groupId: this.configService.get<string>('KAFKA_GROUP_ID') 
    });

    try {
      await this.klineStreamConsumer.connect();
      await this.klineStreamConsumer.subscribe({ 
        topic: this.configService.get<string>('KAFKA_TOPIC_KLINE_STREAM'), 
        fromBeginning: false 
      });

      await this.klineStreamConsumer.run({
        eachMessage: async ({ message }) => {
          const rawValue = message.value?.toString();
          if (!rawValue) {
            this.logger.warning('Received message with empty value.');
            return;
          }

          try {
            const candleData = JSON.parse(rawValue);
            
            // Validate required fields
            if (!candleData.symbol || !candleData.interval || !candleData.open || !candleData.high || !candleData.low || !candleData.close) {
              this.logger.failure('Invalid candle data received', undefined, { 
                symbol: candleData.symbol,
                interval: candleData.interval,
                timestamp: candleData.timestamp,
                is_final: candleData.is_final,
                open: candleData.open,
                high: candleData.high,
                low: candleData.low,
                close: candleData.close,
                volume: candleData.volume
              });
              return;
            }

            const logMessage = candleData.is_final
              ? `Candle data received: ${candleData.symbol} [${candleData.interval}]`
              : `Candle data received (updating): ${candleData.symbol} [${candleData.interval}]`;
            const logMetadata = { 
              symbol: candleData.symbol,
              interval: candleData.interval,
              timestamp: candleData.timestamp,
              is_final: candleData.is_final,
              close: candleData.close,
              volume: candleData.volume
            };

            if (candleData.is_final) {
              this.logger.info(logMessage, logMetadata);
            } else {
              this.logger.debug(logMessage, logMetadata);
            }

            // Emit unified event with all candle data (both final and updating)
            this.eventEmitter.emit('candle.update', candleData);
          } catch (error) {
            this.logger.failure('Failed to parse message value.', error, { rawValue });
          }
        },
      });

      this.logger.info('Kline stream consumer initialized.');
    } catch (error) {
      this.logger.failure('Failed to initialize kline stream consumer.', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    this.logger.info('Disconnecting Kafka consumers...');
    if (this.klineStreamConsumer) {
      await this.klineStreamConsumer.disconnect();
    }
    this.logger.info('All Kafka consumers disconnected.');
  }
}
