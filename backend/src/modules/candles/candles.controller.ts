import { 
  Controller,
  Get,
  Query,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { CandlesService } from './candles.service';

@Controller('candles')
export class CandlesController {
  private readonly logger = new Logger();
  private readonly moduleName = CandlesController.name;

  constructor(private readonly candlesService: CandlesService) {}

  @Get()
  async getCandles(
    @Query('symbol') symbol: string,
    @Query('limit') limit: string,
    @Query('interval') interval: string,
  ) {
    this.logger.log(`[INFO] [${this.moduleName}] Received request for candles: symbol=${symbol}, interval=${interval}, limit=${limit}`);

    if (!symbol) {
      throw new BadRequestException('Missing required query parameter: symbol (e.g., ?symbol=BTCUSDT)');
    }
    const targetSymbol = symbol.toUpperCase();

    let targetLimit = 100;
    if (limit) {
      const parsedLimit = parseInt(limit, 10);
      if (!isNaN(parsedLimit) && parsedLimit > 0) {
        targetLimit = parsedLimit;
      }
    }

    const targetInterval = interval || '1m';

    const data = await this.candlesService.getHistoricalCandles(targetSymbol, targetLimit, targetInterval);
    
    return {
      success: true,
      symbol: targetSymbol,
      interval: targetInterval,
      count: data.length,
      data: data,
    };
  }
}