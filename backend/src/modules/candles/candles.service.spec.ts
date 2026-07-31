import { Test, TestingModule } from '@nestjs/testing';
import { CandlesService } from './candles.service';
import { DatabaseService } from '../database/database.service';
import { RecentCandlesCacheService } from './recent-candles-cache.service';

describe('CandlesService', () => {
  let service: CandlesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CandlesService,
        {
          provide: DatabaseService,
          useValue: {
            query: jest.fn(),
          },
        },
        {
          provide: RecentCandlesCacheService,
          useValue: {
            mergeWithHistory: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<CandlesService>(CandlesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
