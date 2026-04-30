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
  private readonly logger = new Logger();
  private readonly moduleName = KafkaService.name;
  private kafka: Kafka;
  private klineStreamConsumer: Consumer;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async onModuleInit() {
    this.logger.log(`[INFO] [${this.moduleName}] Initializing Kafka consumers...`);

    this.kafka = new Kafka({
      clientId: this.configService.get<string>('KAFKA_CLIENT_ID'),
      brokers: this.configService.get<string>('KAFKA_BROKER').split(','),
    });

    // Single unified consumer for kline stream (contains both final and updating candles)
    await this.initKlineStreamConsumer();

    this.logger.log(`[INFO] [${this.moduleName}] Kafka kline stream consumer initialized and running.`);
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
            this.logger.warn(`[WARN] [${this.moduleName}] Received message with empty value.`);
            return;
          }

          try {
            const candleData = JSON.parse(rawValue);
            
            // Validate required fields
            if (!candleData.open || !candleData.high || !candleData.low || !candleData.close) {
              this.logger.error(`[ERROR] [${this.moduleName}] Invalid candle data received`, { 
                symbol: candleData.symbol,
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

            const logLevel = candleData.is_final ? 'log' : 'debug';
            const logMessage = candleData.is_final
              ? `[INFO] [${this.moduleName}] Candle data received`
              : `[DEBUG] [${this.moduleName}] Candle data received (updating)`;
            this.logger[logLevel](logMessage, { 
              symbol: candleData.symbol,
              timestamp: candleData.timestamp,
              is_final: candleData.is_final,
              close: candleData.close,
              volume: candleData.volume
            });

            // Emit unified event with all candle data (both final and updating)
            this.eventEmitter.emit('candle.update', candleData);
          } catch (error) {
            this.logger.error(`[ERROR] [${this.moduleName}] Failed to parse message value.`, { error, rawValue });
          }
        },
      });

      this.logger.log(`[INFO] [${this.moduleName}] Kline stream consumer initialized.`);
    } catch (error) {
      this.logger.error(`[ERROR] [${this.moduleName}] Failed to initialize kline stream consumer.`);
      throw error;
    }
  }

  async onModuleDestroy() {
    this.logger.log(`[INFO] [${this.moduleName}] Disconnecting Kafka consumers...`);
    if (this.klineStreamConsumer) {
      await this.klineStreamConsumer.disconnect();
    }
    this.logger.log(`[INFO] [${this.moduleName}] All Kafka consumers disconnected.`);
  }
}
