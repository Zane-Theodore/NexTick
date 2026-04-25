import { Test, TestingModule } from '@nestjs/testing';
import { CandlesController } from './candles.controller';
import { CandlesService } from './candles.service';

describe('CandlesController', () => {
  let controller: CandlesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CandlesController],
      providers: [CandlesService],
    }).compile();

    controller = module.get<CandlesController>(CandlesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
