import { 
  Controller,
  Get,
  Query,
  Logger,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CandlesService } from './candles.service';
import { CandlesQueryDto } from './dto/candles-query.dto';
import { CandlesResponseDto } from './dto/candles-response.dto';

@ApiTags('Market Data')
@Controller('candles')
export class CandlesController {
  private readonly logger = new Logger(CandlesController.name);

  constructor(private readonly candlesService: CandlesService) {}

  @Get()
  @ApiOperation({ summary: 'Get historical candle data' })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns the historical candle data',
    type: CandlesResponseDto,
  })
  async getCandles(@Query() query: CandlesQueryDto): Promise<CandlesResponseDto> {
    const { symbol, interval = '1m', limit = 100 } = query;

    this.logger.log(
      `Received request for candles: symbol=${symbol}, interval=${interval}, limit=${limit}`
    );

    const data = await this.candlesService.getHistoricalCandles(
      symbol,
      limit,
      interval,
    );

    return {
      success: true,
      symbol,
      interval,
      count: data.length,
      data,
    };
  }
}
