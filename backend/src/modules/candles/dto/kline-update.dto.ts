import { ApiProperty } from '@nestjs/swagger';
import { CandleDto } from './candle.dto';

export class KlineUpdateDto extends CandleDto {
  @ApiProperty({
    description: 'Whether the candle is closed/final from the stream.',
    example: false,
  })
  is_final: boolean;
}
