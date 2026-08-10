import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseService } from './modules/database/database.service';
import { KafkaService } from './modules/kafka/kafka.service';

describe('AppController', () => {
  let appController: AppController;
  let databaseService: { isAvailable: jest.Mock };
  let kafkaService: { isAvailable: jest.Mock };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: DatabaseService,
          useValue: { isAvailable: jest.fn(() => true) },
        },
        {
          provide: KafkaService,
          useValue: { isAvailable: jest.fn(() => true) },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
    databaseService = app.get(DatabaseService);
    kafkaService = app.get(KafkaService);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('health', () => {
    it('returns healthy status after both dependencies reconnect', () => {
      expect(appController.getHealth()).toMatchObject({
        status: 'ok',
        dependencies: {
          questdb: true,
          kafka: true,
        },
      });
    });

    it('returns 503 while a dependency is reconnecting', () => {
      databaseService.isAvailable.mockReturnValue(false);
      kafkaService.isAvailable.mockReturnValue(true);

      expect(() => appController.getHealth()).toThrow('Service Unavailable');
    });
  });
});
