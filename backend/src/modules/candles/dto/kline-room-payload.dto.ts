import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import {
  CandleInterval,
  VALID_INTERVALS,
} from '../enum/candle-interval.enum';

export class KlineRoomPayloadDto {
  @ApiProperty({
    description: 'Trading pair symbol.',
    example: 'BTCUSDT',
  })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => value?.toUpperCase())
  symbol: string;

  @ApiPropertyOptional({
    description: 'Candle interval used to build the socket room name.',
    enum: VALID_INTERVALS,
    default: '1m',
    example: '1m',
  })
  @IsOptional()
  @IsIn(VALID_INTERVALS)
  interval?: CandleInterval = '1m';
}
