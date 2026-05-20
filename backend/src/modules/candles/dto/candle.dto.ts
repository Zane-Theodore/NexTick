import { ApiProperty } from '@nestjs/swagger';

export class CandleDto {
  @ApiProperty({
    description: 'Candle timestamp in ISO 8601 format.',
    example: '2026-05-20T08:00:00.000Z',
  })
  timestamp: string;

  @ApiProperty({
    description: 'Trading pair symbol.',
    example: 'BTCUSDT',
  })
  symbol: string;

  @ApiProperty({
    description: 'Candle interval.',
    example: '1m',
  })
  interval: string;

  @ApiProperty({ example: 105000.5 })
  open: number;

  @ApiProperty({ example: 105250.75 })
  high: number;

  @ApiProperty({ example: 104900.25 })
  low: number;

  @ApiProperty({ example: 105120.1 })
  close: number;

  @ApiProperty({ example: 12.34567 })
  volume: number;
}
