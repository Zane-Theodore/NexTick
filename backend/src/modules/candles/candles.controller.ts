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
  private readonly logger = new Logger(CandlesController.name);

  constructor(private readonly candlesService: CandlesService) {}

  @Get()
  async getCandles(
  @Query('symbol') symbol: string,
  @Query('limit') limit: string,) {
    this.logger.log(`[GET_CANDLES] Received request for candles with symbol: ${symbol} and limit: ${limit}`);

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

    const data = await this.candlesService.getHistoricalCandles(targetSymbol, targetLimit);
    
    return {
      success: true,
      count: data.length,
      data: data,
    };
  }
}