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
  private consumer: Consumer;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async onModuleInit() {
    this.logger.log('[KAFKA_INIT] Initializing Kafka consumer...');

    this.kafka = new Kafka({
      clientId: this.configService.get<string>('KAFKA_CLIENT_ID'),
      brokers: this.configService.get<string>('KAFKA_BROKER').split(','),
    });

    this.consumer = this.kafka.consumer({ groupId: this.configService.get<string>('KAFKA_GROUP_ID') });

    try {
      await this.consumer.connect();
      await this.consumer.subscribe({ topic: this.configService.get<string>('KAFKA_TOPIC_PROCESSED_CANDLES'), fromBeginning: false });

      await this.consumer.run({
        eachMessage: async ({ message }) => {
          const rawValue = message.value?.toString();
          if (!rawValue) {
            this.logger.warn('[KAFKA_MESSAGE_WARNING] Received message with empty value.');
            return;
          }

          try {
            const candleData = JSON.parse(rawValue);
            this.logger.debug('[KAFKA_MESSAGE_RECEIVED] Received message', { candleData });

            this.eventEmitter.emit('candle.created', candleData);
          } catch (error) {
            this.logger.error('[KAFKA_MESSAGE_ERROR] Failed to parse message value.', { error, rawValue });
          }
        },
      });

      this.logger.log('[KAFKA_INIT_SUCCESS] Kafka consumer initialized and running.');

    } catch (error) {
      this.logger.error('[KAFKA_INIT_ERROR] Failed to initialize Kafka consumer.');
      throw error;
    }
  }

  async onModuleDestroy() {
    this.logger.log('[KAFKA_DESTROY] Disconnecting Kafka consumer...');
    if (this.consumer) {
      await this.consumer.disconnect();
      this.logger.log('[KAFKA_DESTROY_SUCCESS] Kafka consumer disconnected.');
    }
  }
}
