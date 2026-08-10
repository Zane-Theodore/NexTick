import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Kafka, Consumer } from 'kafkajs';
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createLogger } from '../../common/logger';
import {
  KlineUpdateInput,
  normalizeKlineUpdate,
} from '../candles/candle-normalization';

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = createLogger(KafkaService.name);
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
      groupId: this.configService.get<string>('KAFKA_GROUP_ID'),
    });

    try {
      await this.klineStreamConsumer.connect();
      await this.klineStreamConsumer.subscribe({
        topic: this.configService.get<string>('KAFKA_TOPIC_KLINE_STREAM'),
        fromBeginning: false,
      });

      await this.klineStreamConsumer.run({
        eachMessage: ({ message }) =>
          this.handleKlineMessage(message.value?.toString()),
      });

      this.logger.info('Kline stream consumer initialized.');
    } catch (error) {
      this.logger.error('Failed to initialize kline stream consumer.', error);
      throw error;
    }
  }

  private handleKlineMessage(rawValue?: string): Promise<void> {
    if (!rawValue) {
      this.logger.warn('Received message with empty value.');
      return Promise.resolve();
    }

    try {
      const candleData = JSON.parse(rawValue) as KlineUpdateInput;
      const normalizedCandle = this.normalizeKlineUpdate(candleData);

      if (!normalizedCandle) {
        this.logger.error('Invalid candle data received', undefined, {
          symbol: candleData.symbol,
          interval: candleData.interval,
          timestamp: candleData.timestamp,
          is_final: candleData.is_final,
          open: candleData.open,
          high: candleData.high,
          low: candleData.low,
          close: candleData.close,
          volume: candleData.volume,
        });
        return Promise.resolve();
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
        volume: normalizedCandle.volume,
      };

      if (normalizedCandle.is_final) {
        this.logger.info(logMessage, logMetadata);
      } else {
        this.logger.debug(logMessage, logMetadata);
      }

      // Emit unified event with all candle data (both final and updating)
      this.eventEmitter.emit('candle.update', normalizedCandle);
    } catch (error) {
      this.logger.error('Failed to parse message value.', error, {
        rawValue,
      });
    }

    return Promise.resolve();
  }

  private normalizeKlineUpdate(value: KlineUpdateInput) {
    return normalizeKlineUpdate(value);
  }

  async onModuleDestroy() {
    this.logger.info('Disconnecting Kafka consumers...');
    if (this.klineStreamConsumer) {
      await this.klineStreamConsumer.disconnect();
    }
    this.logger.info('All Kafka consumers disconnected.');
  }
}
