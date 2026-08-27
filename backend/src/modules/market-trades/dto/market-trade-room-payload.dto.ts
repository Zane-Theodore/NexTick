import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';
import { normalizeMarketTradeSymbol } from '../market-trade-normalization';

export class MarketTradeRoomPayloadDto {
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }: { value: unknown }) =>
    normalizeMarketTradeSymbol(value),
  )
  symbol: string;
}
