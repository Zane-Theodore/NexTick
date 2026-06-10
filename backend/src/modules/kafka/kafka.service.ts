import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Kafka, Consumer } from 'kafkajs';
import { 
    Injectable,
    OnModuleInit,
    OnModuleDestroy } from '@nestjs/common';
import { AppLogger } from '../../common/logger';
import { KlineUpdateDto } from '../candles/dto/kline-update.dto';
import {
  isValidCandleOhlcv,
  parseCandleNumber,
} from '../candles/candle-validation';

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
            const normalizedCandle = this.normalizeKlineUpdate(candleData);
            
            if (!normalizedCandle) {
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

            const logMessage = normalizedCandle.is_final
              ? `Candle data received: ${normalizedCandle.symbol} [${normalizedCandle.interval}]`
              : `Candle data received (updating): ${normalizedCandle.symbol} [${normalizedCandle.interval}]`;
            const logMetadata = { 
              symbol: normalizedCandle.symbol,
              interval: normalizedCandle.interval,
              timestamp: normalizedCandle.timestamp,
              is_final: normalizedCandle.is_final,
              close: normalizedCandle.close,
              volume: normalizedCandle.volume
            };

            if (normalizedCandle.is_final) {
              this.logger.info(logMessage, logMetadata);
            } else {
              this.logger.debug(logMessage, logMetadata);
            }

            // Emit unified event with all candle data (both final and updating)
            this.eventEmitter.emit('candle.update', normalizedCandle);
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

  private normalizeKlineUpdate(value: Record<string, unknown>): KlineUpdateDto | null {
    const timestamp = new Date(String(value.timestamp ?? ''));

    if (Number.isNaN(timestamp.getTime())) {
      return null;
    }

    const normalizedCandle = {
      timestamp: timestamp.toISOString(),
      symbol: String(value.symbol ?? '').toUpperCase(),
      interval: String(value.interval ?? ''),
      open: parseCandleNumber(value.open),
      high: parseCandleNumber(value.high),
      low: parseCandleNumber(value.low),
      close: parseCandleNumber(value.close),
      volume: parseCandleNumber(value.volume),
      is_final: value.is_final === true,
    };

    if (
      !normalizedCandle.symbol ||
      !normalizedCandle.interval ||
      !isValidCandleOhlcv(normalizedCandle)
    ) {
      return null;
    }

    return normalizedCandle;
  }

  async onModuleDestroy() {
    this.logger.info('Disconnecting Kafka consumers...');
    if (this.klineStreamConsumer) {
      await this.klineStreamConsumer.disconnect();
    }
    this.logger.info('All Kafka consumers disconnected.');
  }
}
