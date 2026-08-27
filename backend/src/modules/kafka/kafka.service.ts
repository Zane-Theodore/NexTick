import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Kafka, Consumer } from 'kafkajs';
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createLogger } from '../../common/logger';
import {
  KlineUpdateInput,
  normalizeKlineUpdate,
} from '../candles/candle-normalization';
import {
  MarketTradeInput,
  normalizeMarketTrade,
} from '../market-trades/market-trade-normalization';
import {
  MarketDepthInput,
  normalizeMarketDepth,
} from '../order-book/market-depth-normalization';

const RECONNECT_DELAY_MS = 5_000;

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = createLogger(KafkaService.name);
  private kafka: Kafka;
  private marketDataConsumer: Consumer;
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

  private handleMarketTradeMessage(rawValue?: string): Promise<void> {
    if (!rawValue) {
      this.logger.warn('Received raw trade message with empty value.');
      return Promise.resolve();
    }

    try {
      const tradeData = JSON.parse(rawValue) as MarketTradeInput;
      const normalizedTrade = normalizeMarketTrade(tradeData);

      if (!normalizedTrade) {
        this.logger.warn('Invalid raw trade received from Kafka.', {
          symbol: tradeData.symbol,
          trade_id: tradeData.trade_id,
          timestamp: tradeData.timestamp,
        });
        return Promise.resolve();
      }

      this.eventEmitter.emit('market-trade.update', normalizedTrade);
    } catch (error) {
      this.logger.error('Failed to parse raw trade message value.', error, {
        rawValue,
      });
    }

    return Promise.resolve();
  }

  private handleMarketDepthMessage(rawValue?: string): Promise<void> {
    if (!rawValue) {
      this.logger.warn('Received market depth message with empty value.');
      return Promise.resolve();
    }

    try {
      const depthData = JSON.parse(rawValue) as MarketDepthInput;
      const normalizedDepth = normalizeMarketDepth(depthData);

      if (!normalizedDepth) {
        this.logger.warn('Invalid market depth received from Kafka.', {
          symbol: depthData.symbol,
          last_update_id: depthData.last_update_id,
        });
        return Promise.resolve();
      }

      this.eventEmitter.emit('market-depth.update', normalizedDepth);
    } catch (error) {
      this.logger.error('Failed to parse market depth message value.', error, {
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
    if (this.marketDataConsumer) {
      await this.marketDataConsumer.disconnect();
    }
    this.logger.info('All Kafka consumers disconnected.');
  }

  private startReconnectLoop(): void {
    if (this.isShuttingDown || this.reconnectPromise !== undefined) {
      return;
    }

    this.reconnectPromise = this.connectWithRetry().finally(() => {
      this.reconnectPromise = undefined;
    });
  }

  private async connectWithRetry(): Promise<void> {
    while (!this.isShuttingDown) {
      try {
        await this.initializeMarketDataConsumer();

        if (this.isShuttingDown) {
          await this.disconnectConsumer();
          return;
        }

        this.isKafkaAvailable = true;
        this.logger.info('Kafka market-data consumer initialized and running.');
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

  private async initializeMarketDataConsumer(): Promise<void> {
    this.marketDataConsumer = this.kafka.consumer({
      groupId: this.configService.get<string>('KAFKA_GROUP_ID'),
      retry: {
        initialRetryTime: 1_000,
        maxRetryTime: 30_000,
        retries: 5,
        restartOnFailure: (error) => {
          this.isKafkaAvailable = false;

          if (this.isShuttingDown) {
            return Promise.resolve(false);
          }

          this.logger.warn(
            'Kafka consumer crashed. Allowing KafkaJS to restart it.',
            {
              error: error.message,
            },
          );
          return Promise.resolve(true);
        },
      },
    });

    this.marketDataConsumer.on(
      this.marketDataConsumer.events.GROUP_JOIN,
      () => {
        if (this.isShuttingDown) {
          return;
        }

        this.isKafkaAvailable = true;
        this.logger.info('Kafka consumer joined its group.');
      },
    );

    this.marketDataConsumer.on(
      this.marketDataConsumer.events.CRASH,
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

    await this.marketDataConsumer.connect();
    await this.marketDataConsumer.subscribe({
      topic: this.configService.get<string>('KAFKA_TOPIC_KLINE_STREAM'),
      fromBeginning: false,
    });
    await this.marketDataConsumer.subscribe({
      topic: this.configService.get<string>('KAFKA_TOPIC_MARKET_TRADES'),
      fromBeginning: false,
    });
    await this.marketDataConsumer.subscribe({
      topic: this.configService.get<string>('KAFKA_TOPIC_MARKET_DEPTH'),
      fromBeginning: false,
    });
    await this.marketDataConsumer.run({
      eachMessage: ({ topic, message }) => {
        const rawValue = message.value?.toString();

        if (
          topic === this.configService.get<string>('KAFKA_TOPIC_MARKET_TRADES')
        ) {
          return this.handleMarketTradeMessage(rawValue);
        }

        if (
          topic === this.configService.get<string>('KAFKA_TOPIC_MARKET_DEPTH')
        ) {
          return this.handleMarketDepthMessage(rawValue);
        }

        return this.handleKlineMessage(rawValue);
      },
    });
  }

  private async disconnectConsumer(): Promise<void> {
    if (!this.marketDataConsumer) {
      return;
    }

    try {
      await this.marketDataConsumer.disconnect();
    } catch (error) {
      this.logger.warn('Failed to disconnect Kafka consumer before retry.', {
        error:
          error instanceof Error
            ? error.message
            : typeof error === 'string'
              ? error
              : 'Unknown Kafka disconnect error',
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
