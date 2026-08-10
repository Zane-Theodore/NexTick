import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Kafka, Consumer } from 'kafkajs';
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createLogger } from '../../common/logger';
import {
  KlineUpdateInput,
  normalizeKlineUpdate,
} from '../candles/candle-normalization';

const RECONNECT_DELAY_MS = 5_000;

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = createLogger(KafkaService.name);
  private kafka: Kafka;
  private klineStreamConsumer: Consumer;
  private isKafkaAvailable = false;
  private isShuttingDown = false;
  private reconnectPromise?: Promise<void>;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  onModuleInit() {
    this.logger.info('Initializing Kafka consumers...');

    this.kafka = new Kafka({
      clientId: this.configService.get<string>('KAFKA_CLIENT_ID'),
      brokers: this.configService.get<string>('KAFKA_BROKER').split(','),
    });

    this.startReconnectLoop();
  }

  isAvailable(): boolean {
    return this.isKafkaAvailable;
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
    this.isShuttingDown = true;
    this.logger.info('Disconnecting Kafka consumers...');
    if (this.klineStreamConsumer) {
      await this.klineStreamConsumer.disconnect();
    }
    this.logger.info('All Kafka consumers disconnected.');
  }

  private startReconnectLoop(): void {
    if (this.isShuttingDown || this.reconnectPromise) {
      return;
    }

    this.reconnectPromise = this.connectWithRetry()
      .finally(() => {
        this.reconnectPromise = undefined;
      });
  }

  private async connectWithRetry(): Promise<void> {
    while (!this.isShuttingDown) {
      try {
        await this.initializeKlineStreamConsumer();

        if (this.isShuttingDown) {
          await this.disconnectConsumer();
          return;
        }

        this.isKafkaAvailable = true;
        this.logger.info('Kafka kline stream consumer initialized and running.');
        return;
      } catch (error) {
        this.isKafkaAvailable = false;
        this.logger.error(
          `Kafka is unavailable. Retrying in ${RECONNECT_DELAY_MS / 1_000}s.`,
          error,
        );
        await this.disconnectConsumer();
        await this.waitBeforeRetry();
      }
    }
  }

  private async initializeKlineStreamConsumer(): Promise<void> {
    this.klineStreamConsumer = this.kafka.consumer({
      groupId: this.configService.get<string>('KAFKA_GROUP_ID'),
      retry: {
        initialRetryTime: 1_000,
        maxRetryTime: 30_000,
        retries: 5,
        restartOnFailure: async (error) => {
          this.isKafkaAvailable = false;

          if (this.isShuttingDown) {
            return false;
          }

          this.logger.warn('Kafka consumer crashed. Allowing KafkaJS to restart it.', {
            error: error.message,
          });
          return true;
        },
      },
    });

    this.klineStreamConsumer.on(
      this.klineStreamConsumer.events.GROUP_JOIN,
      () => {
        if (this.isShuttingDown) {
          return;
        }

        this.isKafkaAvailable = true;
        this.logger.info('Kafka consumer joined its group.');
      },
    );

    this.klineStreamConsumer.on(
      this.klineStreamConsumer.events.CRASH,
      ({ payload }) => {
        this.isKafkaAvailable = false;

        if (this.isShuttingDown) {
          return;
        }

        this.logger.error('Kafka consumer crashed.', payload.error, {
          willRestart: payload.restart,
        });

        if (!payload.restart) {
          this.startReconnectLoop();
        }
      },
    );

    await this.klineStreamConsumer.connect();
    await this.klineStreamConsumer.subscribe({
      topic: this.configService.get<string>('KAFKA_TOPIC_KLINE_STREAM'),
      fromBeginning: false,
    });
    await this.klineStreamConsumer.run({
      eachMessage: ({ message }) =>
        this.handleKlineMessage(message.value?.toString()),
    });
  }

  private async disconnectConsumer(): Promise<void> {
    if (!this.klineStreamConsumer) {
      return;
    }

    try {
      await this.klineStreamConsumer.disconnect();
    } catch (error) {
      this.logger.warn('Failed to disconnect Kafka consumer before retry.', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private waitBeforeRetry(): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, RECONNECT_DELAY_MS);
      timer.unref();
    });
  }
}
