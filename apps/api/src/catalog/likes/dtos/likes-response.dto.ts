import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductBriefDto } from '../../product/dtos/product-response.dto';

export class UserLikeItemDto {
  @ApiProperty() product!: ProductBriefDto;
  @ApiProperty() likedAt!: string; // ISO date
}

export class UserLikesResultDto {
  @ApiProperty({ type: [UserLikeItemDto] }) items!: UserLikeItemDto[];
  @ApiPropertyOptional({ description: 'opaque cursor (base64)' })
  nextCursor?: string;
}
