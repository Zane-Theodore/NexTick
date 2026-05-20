import { ApiProperty } from '@nestjs/swagger';
import { CandleDto } from './candle.dto';

export class CandlesResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({
    description: 'Trading pair symbol.',
    example: 'BTCUSDT',
  })
  symbol: string;

  @ApiProperty({
    description: 'Requested candle interval.',
    example: '1m',
  })
  interval: string;

  @ApiProperty({
    description: 'Number of candles returned.',
    example: 100,
  })
  count: number;

  @ApiProperty({
    description: 'Historical candle data sorted from oldest to newest.',
    type: [CandleDto],
  })
  data: CandleDto[];
}
