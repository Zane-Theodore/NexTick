import { Test, TestingModule } from '@nestjs/testing';
import { CandlesGateway } from './candles.gateway';
import { RecentCandlesCacheService } from './recent-candles-cache.service';

describe('CandlesGateway', () => {
  let gateway: CandlesGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CandlesGateway,
        {
          provide: RecentCandlesCacheService,
          useValue: {
            getKlineUpdates: jest.fn(),
            upsert: jest.fn(),
          },
        },
      ],
    }).compile();

    gateway = module.get<CandlesGateway>(CandlesGateway);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });
});
