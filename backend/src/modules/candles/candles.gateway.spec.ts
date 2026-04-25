import { Test, TestingModule } from '@nestjs/testing';
import { CandlesGateway } from './candles.gateway';

describe('CandlesGateway', () => {
  let gateway: CandlesGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CandlesGateway],
    }).compile();

    gateway = module.get<CandlesGateway>(CandlesGateway);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });
});
