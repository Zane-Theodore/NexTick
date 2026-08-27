import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';
import { normalizeOrderBookSymbol } from '../market-depth-normalization';

export class OrderBookRoomPayloadDto {
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }: { value: unknown }) => normalizeOrderBookSymbol(value))
  symbol: string;
}
