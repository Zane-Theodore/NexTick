import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CandleInterval,
  VALID_INTERVALS,
} from '../enum/candle-interval.enum';

export class CandlesQueryDto {
  @ApiProperty({
    description: 'The trading pair symbol (e.g., BTCUSDT)',
    example: 'BTCUSDT',
  })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => value?.toUpperCase())
  symbol: string;


  @ApiPropertyOptional({
    description: `The interval for the candles. Valid values are: ${VALID_INTERVALS.join(', ')}. Default is '1m'.`,
    enum: VALID_INTERVALS,
    default: '1m',
    example: '1h',
  })
  @IsOptional()
  @IsIn(VALID_INTERVALS)
  interval?: CandleInterval = '1m';


  @ApiPropertyOptional({
    description: 'The maximum number of candles to return (1-2000). Default is 100.',
    minimum: 1,
    maximum: 2000,
    default: 100,
    example: 100,
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === '' ? undefined : Number(value),
  )
  @IsInt()
  @Min(1)
  @Max(2000)
  limit?: number = 100;
}
